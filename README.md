# model-bridge

> **English** · [中文](./README.zh-CN.md)

Self-hosted AI API relay platform — turn your **Claude / OpenAI / Gemini**
subscriptions into standard API endpoints you can share with friends, with
per-user API keys, usage statistics and automatic multi-account rotation.

See **[PLAN.md](./PLAN.md)** for the full architecture and phased roadmap.

## Status

🚧 **Phase A — platform skeleton.** Admin dashboard, authentication and
API-key management are working. The upstream provider relay (Claude / OpenAI /
Gemini OAuth) lands in Phases B–D.

## Tech stack

- **Backend:** Node.js + TypeScript, Fastify, SQLite (Drizzle ORM)
- **Frontend:** Vue 3 + Vite + Naive UI

## Quick start (development)

Requires Node.js 20+.

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

## Configuration

Copy `.env.example` to `.env` to customise. `ENCRYPTION_KEY` and `JWT_SECRET`
are auto-generated on first run; the initial admin account comes from
`ADMIN_USERNAME` / `ADMIN_PASSWORD`. All data lives in the SQLite file under
`./data/` — back up that folder.

> ⚠️ Using subscription OAuth tokens through a relay may violate provider
> Terms of Service and risk account suspension. Intended for your own
> subscriptions, shared within a small trusted group. See PLAN.md.
