# model-bridge

> **English** · [中文](./README.zh-CN.md)

Self-hosted AI API relay platform — turn your **Claude / OpenAI / Gemini**
subscriptions into standard API endpoints you can share with friends, with
per-user API keys, usage statistics and automatic multi-account rotation.

See **[PLAN.md](./PLAN.md)** for the full architecture and phased roadmap.

## Status

🚧 **Phase B — Claude relay.** Admin dashboard, API keys, Claude account
onboarding (OAuth), multi-account rotation, the `/api/claude/v1/messages`
relay and usage logging are working. OpenAI and Gemini land in Phases C–D.

## Tech stack

- **Backend:** Node.js + TypeScript, Fastify, SQLite (Drizzle ORM)
- **Frontend:** Vue 3 + Vite + Naive UI

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

## Production-style run

```bash
cd web && npm install && npm run build && cd ..
npm install
npm start
```

The backend then serves the built dashboard directly at <http://localhost:3000>.

## Connecting Claude Code

Create an API key on the **API Keys** page, add a Claude account on the
**Upstream Accounts** page (via the OAuth flow), then point Claude Code at the relay:

```bash
export ANTHROPIC_BASE_URL=http://localhost:3000/api/claude
export ANTHROPIC_AUTH_TOKEN=mb-xxxxxxxx   # an API key from the dashboard
claude
```

## Configuration

Copy `.env.example` to `.env` to customise. `ENCRYPTION_KEY` and `JWT_SECRET`
are auto-generated on first run; the initial admin account comes from
`ADMIN_USERNAME` / `ADMIN_PASSWORD`. All data lives in the SQLite file under
`./data/` — back up that folder.

> ⚠️ Using subscription OAuth tokens through a relay may violate provider
> Terms of Service and risk account suspension. Intended for your own
> subscriptions, shared within a small trusted group. See PLAN.md.
