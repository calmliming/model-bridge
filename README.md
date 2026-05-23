# model-bridge

> **English** · [中文](./README.zh-CN.md)

Self-hosted AI API relay platform — turn your **Claude / OpenAI / Gemini**
subscriptions into standard API endpoints you can share with friends, with
per-user API keys, usage statistics and automatic multi-account rotation.

See **[PLAN.md](./PLAN.md)** for the full architecture and phased roadmap.

## Status

✅ **v1 shipped.** Admin dashboard, API keys with per-key cost quotas, Claude
(paste-code OAuth) / OpenAI (browser callback) / Gemini (Google OAuth +
Code Assist) account onboarding, multi-account rotation, three relay surfaces
(`/api/claude/v1/messages`, `/api/openai/v1/responses`,
`/api/gemini/v1beta/models/*`), usage logging with daily / provider / model
/ key breakdowns, and a one-command Docker deploy.

## Tech stack

- **Backend:** Node.js + TypeScript, Fastify, SQLite (Drizzle ORM)
- **Frontend:** Vue 3 + Vite + Naive UI + ECharts

## Quick start (development)

Requires Node.js 20+.

```bash
# Start backend and frontend together with formatted API / WEB log prefixes.
npm install
cd web && npm install && cd ..
npm run dev:all
```

Or start them separately:

```bash
# Backend — port 3000. Installs deps; secrets are auto-generated into .env.
npm install
npm run dev

# Frontend dev server — port 5173, proxies /api to the backend.
cd web
npm install
npm run dev
```

Open <http://localhost:5173> and log in with **admin / admin**, then change
the password under **Settings** immediately.

## Deploy

### With Docker (recommended)

```bash
./install.sh
```

`install.sh` generates a `.env` with random `ENCRYPTION_KEY` / `JWT_SECRET`,
then `docker compose up -d --build`. Once it finishes:

- Dashboard: <http://localhost:3000>
- OAuth callback listener: `localhost:1455` (browser must reach it during
  OpenAI / Google sign-in)
- Default admin: `admin / admin` — change it under **Settings** before
  exposing the dashboard

Stop and view logs:

```bash
docker compose down
docker compose logs -f
```

### Without Docker

```bash
cd web && npm install && npm run build && cd ..
npm install
npm start
```

The backend then serves the built dashboard directly at <http://localhost:3000>.

## Connecting clients

Create an API key on the **API Keys** page first, and add at least one
upstream account on the **Upstream Accounts** page (paste-code for Claude,
browser callback for OpenAI/Gemini).

### Claude Code

```bash
export ANTHROPIC_BASE_URL=http://localhost:3000/api/claude
export ANTHROPIC_AUTH_TOKEN=mb-xxxxxxxx
claude
```

### Codex CLI

Recent Codex CLI reads the OpenAI base URL from `~/.codex/config.toml` or
environment variables:

```toml
# ~/.codex/config.toml
[backend]
base_url = "http://localhost:3000/api/openai"
api_key  = "mb-xxxxxxxx"
```

```bash
# or via env (depending on your Codex CLI version)
export OPENAI_BASE_URL=http://localhost:3000/api/openai
export OPENAI_API_KEY=mb-xxxxxxxx
codex
```

The relay only exposes the OpenAI **Responses** API (`/v1/responses`) since
that's what Codex CLI uses. A Chat-Completions surface for Cherry Studio /
generic OpenAI clients is not implemented.

### Cherry Studio

Add a custom provider per service:

- **Anthropic** — base URL `http://localhost:3000/api/claude`, API key `mb-xxxx`
- **Gemini** — base URL `http://localhost:3000/api/gemini`, API key `mb-xxxx`
- **OpenAI** — not yet (see the Codex CLI note above)

### Gemini CLI

Gemini CLI's official build doesn't expose a base-URL override, so it can't
be pointed at the relay directly. Use **Cherry Studio** (or any tool that
lets you set the Gemini base URL) for the Gemini relay.

## Configuration

For Docker deploys, `install.sh` writes everything into the host `.env`.
For non-Docker runs, copy `.env.example` to `.env`; `ENCRYPTION_KEY` and
`JWT_SECRET` are auto-generated on first start. All data lives in the SQLite
file under `./data/` — back up that folder.

## Remote deployment

If you run model-bridge on a remote host (VPS / NAS / home server), the
**OAuth callback on `localhost:1455` doesn't reach back** from the cloud
provider's sign-in page. Two options:

1. **SSH tunnel.** On the laptop where you do the OAuth flow, run
   `ssh -L 1455:127.0.0.1:1455 your-server` before clicking "生成授权链接".
   The browser's redirect to `http://localhost:1455/...` now lands in the
   remote container via the tunnel. Disconnect once accounts are added.
2. **Add accounts locally**, then move `./data/` to the remote host. Tokens
   stay valid; the background refresh job keeps them alive.

> ⚠️ Using subscription OAuth tokens through a relay may violate provider
> Terms of Service and risk account suspension. Intended for your own
> subscriptions, shared within a small trusted group. See PLAN.md.
