# model-bridge

> **English** · [中文](./README.zh-CN.md)

Self-hosted AI API relay platform — turn your **Claude / OpenAI / Gemini /
DeepSeek / Xiaomi MiMo** accounts or API keys into standard API endpoints you
can share with friends, with per-user API keys, usage statistics and automatic
multi-account rotation.

See **[PLAN.md](./PLAN.md)** for the full architecture and phased roadmap.

## Status

✅ **v1 shipped.** Admin dashboard, API keys with per-key cost quotas, Claude
(paste-code OAuth) / OpenAI (browser callback) / Gemini (Google OAuth +
Code Assist) / DeepSeek and Xiaomi MiMo (API key) account onboarding,
multi-account rotation with configurable priority, account groups, concurrency
caps and quota auto-pause, relay surfaces with legacy `/api/*` paths plus clean
provider-native aliases (`/v1/messages`, `/v1/responses`,
`/v1/chat/completions`, `/v1/models`, `/v1beta/models/*`), usage logging with
daily / provider / model / key breakdowns, and a one-command Docker deploy.

## Tech stack

- **Backend:** Node.js + TypeScript, Fastify, PostgreSQL (Drizzle ORM)
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

`install.sh` generates a `.env` with random `ENCRYPTION_KEY` / `JWT_SECRET` /
`UPDATE_TOKEN`,
then `docker compose up -d --build`. Once it finishes:

- Dashboard: <http://localhost:3001>
- OAuth callback listener: `localhost:1455` (browser must reach it during
  OpenAI / Google sign-in)
- Default admin: `admin / admin` — change it under **Settings** before
  exposing the dashboard

Docker deploys also start the internal `model-bridge-updater` service. After
logging in, use the **System update** card under **Settings** to check and
upgrade to the latest `origin/main`.

Optional login hardening:

- Set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` to require Cloudflare
  Turnstile on login/register.
- `SECURITY_HEADERS_ENABLED=true` is the default and sends CSP plus common
  browser security headers. Set it to `false` only if a reverse proxy owns
  those headers.
- The service automatically trusts directly connected reverse proxies from
  loopback, RFC1918 private, and IPv6 ULA ranges, then resolves
  `X-Forwarded-For`. Forwarded headers from public direct peers are ignored.
  Do not expose the origin directly to untrusted private-network clients, which
  could otherwise spoof their source IP.

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

### Changing the port

- **Backend** — set `PORT=<port>` in `.env` (defaults to 3000).
- **Frontend dev server** — edit `server.port` in [web/vite.config.ts](web/vite.config.ts) (defaults to 5173).
- **Dev proxy target** — if you change the backend port, also update the
  proxy targets in [web/vite.config.ts](web/vite.config.ts) (`/api`, `/health`),
  otherwise `npm run dev:all` will not be able to reach the backend.
- **Docker** — change the host-side port in `docker-compose.yml` (the mapping
  is `3001:3000`; only the left side is the published port).

## Connecting clients

Create an API key on the **API Keys** page first, and add at least one
upstream account on the **Upstream Accounts** page (paste-code for Claude,
browser callback for OpenAI/Gemini, API key for DeepSeek/Xiaomi MiMo).

API keys can optionally restrict providers/models, bind to an account group,
set rate/concurrency/cost limits, and define model mappings such as
`gpt-public=gpt-5.4`. Model mappings are client-facing aliases:
`GET /v1/models` lists the alias, while relay requests are sent upstream with
the mapped model.

### Account pool scheduling

When you have multiple accounts for the same provider, scheduling can be tuned
with:

- **Priority**: set 1–100 (default 1) in the accounts table. Higher values are
  tried first; ties fall back to least-recently-used rotation.
- **Account groups**: create named pools on the **Account Groups** page.
  Accounts can join multiple groups; an API key bound to a group only schedules
  inside that group, while unbound keys use the default pool (accounts with no
  group membership).
- **Concurrency caps**: accounts and API keys can both limit simultaneous
  in-flight requests. Leave blank for unlimited.
- **Quota auto-pause**: set a global usage-percent threshold under **Settings**.
  Accounts pause until the breaching quota window resets, and each account can
  inherit, override, or disable the threshold.

The account page also has a manual health check. It records the latest
connectivity result on each account without running continuously in the
background, so existing deployments do not start spending quota unexpectedly.

### Claude Code

```bash
export ANTHROPIC_BASE_URL=http://localhost:3000
export ANTHROPIC_AUTH_TOKEN=mb-xxxxxxxx
claude
```

To route Claude Code through DeepSeek or Xiaomi MiMo's Anthropic-compatible
upstreams instead, point `ANTHROPIC_BASE_URL` at
`http://localhost:3000/api/deepseek` or `http://localhost:3000/api/xiaomi`.
Each one shares its account pool with the matching Codex / OpenAI-compatible
endpoints.

### Codex CLI

Recent Codex CLI uses `model_providers` for a custom Responses API:

```toml
# ~/.codex/config.toml
[profiles.model-bridge]
model_provider = "model-bridge"
model = "gpt-5.5"

[model_providers.model-bridge]
name = "model-bridge"
base_url = "http://localhost:3000/v1"
env_key = "MODEL_BRIDGE_API_KEY"
wire_api = "responses"
requires_openai_auth = false
```

```bash
export MODEL_BRIDGE_API_KEY=mb-xxxxxxxx
codex --profile model-bridge
```

The relay exposes OpenAI **Responses** (`/v1/responses`) for Codex CLI and a
compatibility **Chat Completions** surface (`/v1/chat/completions`) for
OpenAI-compatible clients. The Chat Completions path is translated through
the same Responses backend. OpenAI image generation is also exposed through
`/v1/images/generations` and `/v1/images/edits` (plus the matching
`/api/openai/v1/...` paths), bridged through ChatGPT OAuth accounts to the
Responses `image_generation` tool. Embeddings are still not exposed.
`GET /v1/models` returns a compatibility model list filtered by the API key's
provider and model allow-lists.

```bash
curl http://localhost:3000/v1/images/generations \
  -H "Authorization: Bearer mb-xxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-image-2","prompt":"an orange cat beside a window","size":"1024x1024"}'
```

```bash
curl http://localhost:3000/v1/images/edits \
  -H "Authorization: Bearer mb-xxxxxxxx" \
  -F "model=gpt-image-2" \
  -F "prompt=replace the sky with an aurora" \
  -F "image=@./source.png"
```

Set `stream:true` for `image_generation.partial_image` and
`image_generation.completed` SSE events (`image_edit.*` for edits). The default
image model is `gpt-image-2`; set `OPENAI_IMAGE_GENERATION_ENABLED=false` to
disable the Images endpoints and explicit image tools on Responses. Image
options follow the [OpenAI Image Generation guide](https://developers.openai.com/api/docs/guides/image-generation).

### Codex CLI on DeepSeek

Run Codex CLI against your DeepSeek API key. The relay exposes a
Responses-API surface at `/api/deepseek/v1/responses` that rewrites incoming
requests into DeepSeek's `chat/completions` format and translates the
streamed reply back into Responses events. The same DeepSeek account pool is
shared with `/api/deepseek/v1/messages` (used by Claude Code), so **one
DeepSeek API key serves both clients**. OpenAI-compatible clients can also use
DeepSeek directly with base URL `http://localhost:3000/api/deepseek/v1` and
the `chat/completions` endpoint.

#### 1. Prepare the dashboard

- **Upstream Accounts** → add a DeepSeek account and paste in your DeepSeek API key (`sk-...`)
- **API Keys** → create a relay key (you'll get `mb-xxxxxxxx`); if you set `allowedProviders`, include `deepseek`

#### 2. Edit `~/.codex/config.toml`

```toml
[profiles.model-bridge-deepseek]
model_provider = "model-bridge-deepseek"
model = "deepseek-v4-pro"   # or "deepseek-v4-flash" for the cheaper, lighter variant

[model_providers.model-bridge-deepseek]
name = "model-bridge-deepseek"
base_url = "http://localhost:3000/api/deepseek/v1"
env_key = "MODEL_BRIDGE_API_KEY"
wire_api = "responses"
requires_openai_auth = false
```

- `base_url` must include the `/api/deepseek/v1` prefix — don't shorten it to bare `/v1`
- Replace `localhost:3000` with your real host (e.g. `https://your-host`) if the relay isn't local

#### 3. Run Codex

```bash
export MODEL_BRIDGE_API_KEY=mb-xxxxxxxx
codex --profile model-bridge-deepseek
```

#### 4. Verify (optional)

If you're unsure the route works, smoke-test it with curl:

```bash
curl -N -X POST http://localhost:3000/api/deepseek/v1/responses \
  -H "Authorization: Bearer mb-xxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-pro","input":"say hi","stream":true}'
```

A healthy response is an SSE stream: `response.created` → several
`response.output_text.delta` → `response.completed`.

#### Notes

- **Model-name rewrite**: anything starting with `deepseek-` is passed through (`deepseek-v4-pro` / `deepseek-v4-flash` / `deepseek-reasoner` etc.); everything else (including Codex's default `gpt-5-codex`) is forced to `deepseek-v4-pro`, so the route works even if `model` is wrong or absent in your toml.
- **Always streams**: this endpoint ignores the client's `stream` field and always returns `text/event-stream`.
- **Usage stats**: calls are recorded under `provider=deepseek` and share the same dashboard with the messages endpoint.

### Codex CLI on Xiaomi MiMo

Xiaomi MiMo uses the same pattern as DeepSeek: add a Xiaomi MiMo account in
the dashboard with its API key, then use `/api/xiaomi/v1/messages`,
`/api/xiaomi/v1/chat/completions`, or `/api/xiaomi/v1/responses`. Codex config:

```toml
[profiles.model-bridge-mimo]
model_provider = "model-bridge-mimo"
model = "mimo-v2.5-pro"   # or "mimo-v2.5"

[model_providers.model-bridge-mimo]
name = "model-bridge-mimo"
base_url = "http://localhost:3000/api/xiaomi/v1"
env_key = "MODEL_BRIDGE_API_KEY"
wire_api = "responses"
requires_openai_auth = false
```

```bash
export MODEL_BRIDGE_API_KEY=mb-xxxxxxxx
codex --profile model-bridge-mimo
```

Model names starting with `mimo-` are passed through; everything else is
rewritten to `mimo-v2.5-pro`. The Responses endpoint always streams and usage
is recorded under `provider=xiaomi`.

### Cherry Studio

Add a custom provider per service:

- **Anthropic** — base URL `http://localhost:3000`, API key `mb-xxxx`
- **Gemini** — base URL `http://localhost:3000`, API key `mb-xxxx`
- **OpenAI** — base URL `http://localhost:3000/v1`, API key `mb-xxxx`
- **DeepSeek as OpenAI** — base URL `http://localhost:3000/api/deepseek/v1`, API key `mb-xxxx`
- **Xiaomi MiMo as OpenAI** — base URL `http://localhost:3000/api/xiaomi/v1`, API key `mb-xxxx`

### Gemini CLI

Gemini CLI's official build doesn't expose a base-URL override, so it can't
be pointed at the relay directly. Use **Cherry Studio** (or any tool that
lets you set the Gemini base URL) for the Gemini relay.

## Configuration

For Docker deploys, `install.sh` writes everything into the host `.env`.
For non-Docker runs, copy `.env.example` to `.env`; `ENCRYPTION_KEY` and
`JWT_SECRET` are auto-generated on first start. Set `PG_PASSWORD` and
`DATABASE_URL` before the first boot — the bundled `postgres` container
stores its data under `./data/pg/`, so back up that folder.

On `SIGTERM`/`SIGINT`, the service stops accepting new requests and waits for
in-flight requests, OAuth callbacks, background jobs, and usage billing writes
before closing PostgreSQL/Redis. The shutdown timeout is fixed at 30 seconds;
Docker Compose grants a 35-second stop grace period.

### Upgrading from the old SQLite version (one-click)

If you used to run the SQLite version (`./data/model-bridge.db` exists),
**just run the two scripts** after pulling — no manual steps needed:

```bash
git pull
./install.sh          # tops up .env with PG_PASSWORD / DATABASE_URL
./migrate-to-pg.sh    # backs up SQLite → starts PG → auto-creates tables → imports data → brings stack up
```

The migration prints progress for each table and refuses to continue if
row counts don't match. The old SQLite file is preserved as
`./data/model-bridge.db.bak-<timestamp>` — don't delete it until you've
verified everything works.

### Sharing data between local dev and prod

Because the database now runs as a real PostgreSQL service, your local dev
process can connect to the production database through an SSH tunnel —
no manual export/import required. Add to your `~/.ssh/config`:

```sshconfig
Host model-bridge-prod
  HostName your.server.com
  User your-ssh-user
  LocalForward 5432 127.0.0.1:5432
```

Then `ssh model-bridge-prod` and set `DATABASE_URL=postgres://model_bridge:PASSWORD@127.0.0.1:5432/model_bridge`
in your local `.env`. The backend prints a loud warning at startup when
`NODE_ENV != production` and the DB host isn't `localhost`, so you know
you're writing to prod. The production PostgreSQL port is bound to
`127.0.0.1` only — it's not exposed on the public internet.

## Remote deployment

If you run model-bridge on a remote host (VPS / NAS / home server), the
**OAuth callback on `localhost:1455` doesn't reach back** from the cloud
provider's sign-in page. Three options:

| Method | Description | Best for |
| ------ | ----------- | -------- |
| **Paste callback URL** (recommended) | After authorizing in the browser, copy the full redirect URL from the address bar (`localhost:1455/auth/callback?code=...`) and paste it into the dashboard. The system auto-extracts code/state. | No extra tools needed |
| **SSH tunnel** | Run `ssh -L 1455:127.0.0.1:1455 your-server` locally before authorizing. The browser's `localhost:1455` redirect is forwarded to the server. | Occasional account setup |
| **Move database** | Add accounts locally first, then copy `./data/` to the remote host. The background refresh job keeps tokens alive. | Bulk migration |

You can also use the **Direct Import Token** feature on the Add Account page
if you already have an Access Token / Refresh Token — this bypasses OAuth entirely.
For multiple accounts at once, use **Batch Import JSON**; see
[docs/account-import-example.json](docs/account-import-example.json) for the
native format and [docs/codex-import-example.json](docs/codex-import-example.json)
for Codex session exports. These files contain sensitive credentials, so keep
them local and out of commits.

### Docker deployment notes

Docker Compose maps `3001:3000` (external 3001 → container 3000).
Access the dashboard at `http://<server-ip>:3001`.

### Updating a deployed instance

Docker Compose deploys can check and upgrade from **Settings → System update**
in the dashboard. If the updater is unavailable, or you need to handle local
production changes manually, run:

```bash
cd ~/model-bridge
git pull
docker compose up -d --build    # full rebuild (backend + frontend)
```

If only the frontend changed:

```bash
cd web && npm run build && cd ..
docker compose restart
```

The `./data` directory is volume-mounted (PostgreSQL data lives under
`./data/pg/`) — rebuilding does not lose the database or account data.
Back up `./data` regularly.

> ⚠️ Using subscription OAuth tokens through a relay may violate provider
> Terms of Service and risk account suspension. Intended for your own
> subscriptions, shared within a small trusted group. See PLAN.md.
