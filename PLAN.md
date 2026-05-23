# model-bridge — Implementation Plan

> **English** · [中文](./PLAN.zh-CN.md)

## Context

`model-bridge` is a self-hosted AI API relay platform ("中转平台") for personal use and
small-group sharing. The user holds subscriptions to **Claude** (Pro/Max), **OpenAI**
(ChatGPT Plus/Pro) and **Google Gemini**, which normally only work through their official
CLIs via OAuth. The platform captures each subscription's OAuth credentials and re-exposes
them as **standard provider-format API endpoints**, so the user and a few friends can drive
Claude Code / Codex CLI / Gemini CLI / Cherry Studio through one self-controlled gateway —
sharing subscriptions and cost — with per-user API keys, token/cost statistics, and
**automatic multi-account rotation** for stability. Requests are relayed straight to the
official provider endpoints; the platform is the only intermediary and is self-hosted, so
no third party sees the traffic.

**Confirmed decisions:** fresh **Node.js + TypeScript** codebase (referencing mature
open-source implementations for the hard OAuth/upstream-protocol parts, not reverse-engineering
from zero); **SQLite** single-file storage; **all three providers** in v1.

> ⚠️ **Caveat to flag before building.** Using subscription OAuth tokens through a relay
> with non-official tools may violate provider Terms of Service and risk **account
> suspension** — as of early 2026 Anthropic's ToS restricts Claude Code OAuth tokens to
> Claude Code / claude.ai. This is a known trade-off of every project in this category.
> Intended use: your own subscriptions, shared with a small trusted group.

## Reference projects (cite for the fragile OAuth / upstream-protocol details)

| Project | Use as reference for |
|---|---|
| [Wei-Shaw/claude-relay-service](https://github.com/Wei-Shaw/claude-relay-service) | Claude OAuth flow, account pooling, request-shaping, usage stats (Node.js — closest match) |
| [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) | All three providers' OAuth + upstream protocol quirks (Go) |
| [EvanZhouDev/openai-oauth](https://github.com/EvanZhouDev/openai-oauth), [AmazingAng/auth2api](https://github.com/AmazingAng/auth2api) | OpenAI/ChatGPT OAuth + Codex backend |

## Architecture

```
client (Claude Code / Codex CLI / Gemini CLI / Cherry Studio)
   │  request in provider-native format + platform API key (mb-xxxx)
   ▼
┌─────────────────────── model-bridge ───────────────────────┐
│ apiKeyAuth ─▶ relay route ─▶ account scheduler (pick acct)  │
│                    │              │ rotation / sticky /      │
│                    │              │ cooldown+failover        │
│                    ▼              ▼                          │
│             provider relay  ◀─ encrypted OAuth token         │
│             (transform req, inject headers, swap auth)        │
│                    │                                         │
│                    ▼  stream SSE back ──▶ usage recorder      │
└──────────────────────────────────────────────────────────────┘
                     │ direct HTTPS, no third party
                     ▼
   api.anthropic.com  /  chatgpt.com/backend-api/codex  /  cloudcode-pa.googleapis.com
```

**Scope note (v1):** expose each provider's **native API format** only (Anthropic Messages,
OpenAI Responses/Chat, Gemini generateContent). Cross-format translation (e.g. OpenAI-format
request → Claude backend) is explicitly **out of scope for v1**.

## Tech stack

- **Backend:** Node.js 20+ / TypeScript, **Fastify** (`@fastify/static`, `@fastify/jwt`),
  **undici** for upstream streaming calls.
- **Storage:** **SQLite** via **Drizzle ORM** + `better-sqlite3` (`drizzle-kit` migrations).
- **Frontend:** **Vue 3** + Vite + TypeScript + **Naive UI** (component library) + Pinia +
  Vue Router; charts via ECharts. Built to static assets, served by Fastify.
- **Crypto/auth:** Node `crypto` AES-256-GCM for token-at-rest; `bcrypt` for admin password;
  JWT for admin sessions. Background token refresh via `node-cron`. Config via `dotenv` + `zod`.

## Project structure (files to create)

```
model-bridge/
├── package.json  tsconfig.json  drizzle.config.ts  .env.example
├── Dockerfile  docker-compose.yml  install.sh  README.md
├── src/
│   ├── index.ts                  bootstrap Fastify + routes + cron
│   ├── config.ts                 env loading (zod-validated)
│   ├── crypto.ts                 AES-256-GCM encrypt/decrypt
│   ├── db/{schema.ts,index.ts,migrations/}
│   ├── middleware/{apiKeyAuth.ts,adminAuth.ts}
│   ├── providers/
│   │   ├── types.ts              Provider interface (shared abstraction)
│   │   ├── registry.ts           provider lookup by id
│   │   ├── claude/{oauth.ts,relay.ts,usage.ts}
│   │   ├── openai/{oauth.ts,relay.ts,usage.ts}
│   │   └── gemini/{oauth.ts,relay.ts,usage.ts}
│   ├── accounts/{manager.ts,scheduler.ts}
│   ├── keys/manager.ts
│   ├── usage/{recorder.ts,stats.ts,pricing.ts}
│   ├── routes/{relay.ts,admin.ts}
│   └── jobs/tokenRefresh.ts
├── web/  (Vue 3 + Naive UI SPA: Login/Overview/Accounts/ApiKeys/Stats/Settings)
└── data/ (SQLite file — gitignored, Docker volume)
```

## Data model (SQLite tables — `src/db/schema.ts`)

- **`accounts`** — id, provider, name, `oauth_access_token`(enc), `oauth_refresh_token`(enc),
  token_expires_at, status (`active`/`rate_limited`/`error`/`disabled`), cooldown_until,
  proxy_url, weight, last_used_at, metadata(json).
- **`api_keys`** — id, name, owner_label (friend name), key_hash, key_prefix, enabled,
  allowed_providers(json), allowed_models(json), rate_limit, quota_limit, quota_used,
  expires_at, created_at.
- **`usage_logs`** — id, api_key_id, account_id, provider, model, ts, input_tokens,
  output_tokens, cache_create_tokens, cache_read_tokens, cost, status, latency_ms.
- **`model_pricing`** — provider, model, input/output/cache-write/cache-read price per 1M
  tokens (seeded with current rates; editable in Settings).
- **`oauth_sessions`** — transient: state, code_verifier, provider (in-progress OAuth).
- **`settings`** — admin_password_hash, jwt_secret, misc config.

## Provider abstraction

`src/providers/types.ts` defines one interface so the relay/scheduler stay provider-agnostic
and a 4th provider is just a new module:

```ts
interface Provider {
  id: 'claude' | 'openai' | 'gemini'
  buildAuthorizeUrl(state, codeVerifier): string
  exchangeCode(code, codeVerifier): Promise<TokenSet>
  refreshToken(refreshToken): Promise<TokenSet>
  routes: RelayRouteSpec[]                       // public endpoints it serves
  relay(req, account): Promise<UpstreamResponse>  // transform + call + stream
  parseUsage(events): UsageData
}
```

| Provider | OAuth | Upstream endpoint | Public relay route | Key quirks to handle |
|---|---|---|---|---|
| **Claude** | claude.ai OAuth + PKCE, manual code-paste | `api.anthropic.com/v1/messages` | `POST /api/claude/v1/messages` | inject `anthropic-beta: oauth-*`, `anthropic-version`, Claude-Code system identity; sticky-session per conversation for prompt-cache hits |
| **OpenAI** | `auth.openai.com/oauth/token` | `chatgpt.com/backend-api/codex/responses` | `POST /api/openai/v1/responses` (+ `/v1/chat/completions`) | must send `stream:true`, `store:false`, `instructions`; strip `max_output_tokens`/`parallel_tool_calls` |
| **Gemini** | Google OAuth | `cloudcode-pa.googleapis.com` (Code Assist) | `POST /api/gemini/v1beta/models/{model}:streamGenerateContent` | free quota ~1000/day, 60/min |

## Progress

- ✅ Phase 0 — Plan documents (`201af14`)
- ✅ Phase A — Skeleton & platform core (`832ab86`)
- ✅ Phase B — Claude relay end-to-end (`afc2ad4`, +`3443a2c` Cloudflare fix)
- ✅ Phase C — OpenAI / Codex
- ✅ Phase D — Gemini
- ✅ Phase E — Stats & management polish
- ✅ Phase F — Deployment & docs

## Implementation phases

All phases ship in v1. Order is **Claude-first** to validate the architecture, then OpenAI &
Gemini replicate the same provider-module pattern.

**Phase 0 — Plan documents (this file).** This implementation plan lives in the repo root as
two in-sync files — `PLAN.md` (English) and `PLAN.zh-CN.md` (中文) — serving as the project's
living roadmap. Update both whenever scope changes.

**Phase A — Skeleton & platform core.** TS project setup; Fastify bootstrap + `config.ts`;
SQLite/Drizzle schema + migrations; `crypto.ts`; admin auth (`adminAuth.ts`, bcrypt+JWT);
`apiKeyAuth.ts` (accepts `Authorization: Bearer` / `x-api-key` / `?key=`); `keys/manager.ts`
(create/revoke `mb-`-prefixed keys, store hash only); health endpoint; Vue SPA scaffold +
Login page served by Fastify. → *Admin logs in, creates/revokes keys.*

**Phase B — Provider abstraction + Claude end-to-end.** `providers/types.ts`;
`accounts/manager.ts` (CRUD, encrypted tokens); `accounts/scheduler.ts` (healthy-account
selection, round-robin + sticky-session, cooldown on 429/5xx, failover retry —
**multi-account rotation**); `providers/claude/{oauth,relay,usage}.ts`; relay route
`/api/claude/v1/messages`; `usage/recorder.ts` + `pricing.ts`; `jobs/tokenRefresh.ts` cron;
Accounts page (add Claude account via OAuth, enable/disable/delete, status). → *Claude Code →
relay → real subscription, streaming + usage logging works.*

**Phase C — OpenAI / Codex.** `providers/openai/*` mirroring Claude; routes
`/api/openai/v1/responses` + `/v1/chat/completions`; handle Codex backend requirements;
add-OpenAI-account UI.

**Phase D — Gemini.** `providers/gemini/*`; route `…:streamGenerateContent` +
`:generateContent`; Google OAuth callback; add-Gemini-account UI.

**Phase E — Stats & management polish.** `usage/stats.ts` aggregations (by key/account/day/
model, tokens + cost); admin stats endpoints; Vue Stats page (ECharts), API Keys page
(limits: rate/quota/expiry/allowed providers+models), Settings page (admin password, pricing
editor); per-key quota enforcement in relay path.

**Phase F — Deployment & docs.** Multi-stage `Dockerfile` (build web + backend → slim
runtime); `docker-compose.yml` (volume for `/data` SQLite); `install.sh` one-click script;
`.env.example` (`PORT`, `ENCRYPTION_KEY`, admin creds, `JWT_SECRET`); README with per-client
config (`ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` for Claude Code, base-URL overrides for
Codex CLI / Gemini CLI, custom-provider setup for Cherry Studio).

## Risks & mitigations

- **ToS / account bans** — see caveat above; document it in README, keep usage to a trusted group.
- **Undocumented flows change** — OAuth endpoints & "look like the official CLI" request
  shaping are reverse-engineered and break over time; isolate them in `providers/*` modules
  and keep reference projects pinned.
- **Security** — encrypt tokens at rest; strong admin auth + login rate-limit + HTTPS in
  production (the reference project shipped an admin-auth-bypass CVE — do not repeat it).
- **Streaming usage parsing** — observe the SSE stream for the `usage` event without
  buffering or breaking passthrough (tee the stream).

## Verification

1. **Build & run:** `npm install && npm run dev` (backend) + `npm run dev` in `web/`; or
   `docker compose up -d`.
2. **Unit tests:** `crypto.ts` encrypt/decrypt round-trip; `pricing.ts` cost calc;
   `scheduler.ts` account selection (rotation, sticky, cooldown skip).
3. **End-to-end per provider** (needs a real subscription each):
   - Add the account in the dashboard via its OAuth flow; create an API key.
   - Claude Code: `ANTHROPIC_BASE_URL=http://localhost:3000/api/claude
     ANTHROPIC_AUTH_TOKEN=mb-xxxx claude` → run a prompt, confirm streamed reply.
   - Codex CLI / Gemini CLI: point base URL at `…/api/openai` / `…/api/gemini`, key
     `mb-xxxx` → run a prompt.
   - Confirm dashboard **Stats** shows the request with token counts + cost.
4. **Multi-account failover:** register 2 accounts, disable / force-cooldown the in-use one,
   send a request, confirm the scheduler routes to the other.
5. **Token refresh:** set an account's `token_expires_at` near now, confirm `tokenRefresh`
   cron refreshes it.
6. **Persistence:** `docker compose restart`, confirm accounts/keys/logs survive (SQLite
   volume).
