# syntax=docker/dockerfile:1.7
#
# Multi-stage build: web bundle → backend prod deps → slim runtime.
#

# ── Stage 1: build the Vue admin dashboard ───────────────────────
FROM node:20-bookworm-slim AS web-builder
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ── Stage 2: install backend production dependencies ────────────
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# tsx lives in `dependencies` so --omit=dev still leaves it available
# at runtime; `pg` ships pure JS, no native build step required.
RUN npm ci --omit=dev --no-audit --no-fund

# ── Stage 3: internal system updater ─────────────────────────────
FROM docker:27-cli AS updater
WORKDIR /app
RUN apk add --no-cache git nodejs

COPY scripts ./scripts

EXPOSE 3002

CMD ["node", "scripts/updater.mjs"]

# ── Stage 4: slim runtime image ─────────────────────────────────
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY scripts ./scripts
COPY --from=web-builder /web/dist ./web/dist

# 3000 = HTTP API + admin dashboard. 1455 = OAuth callback (OpenAI &
# Google's installed-app redirects only accept loopback callbacks).
EXPOSE 3000 1455

CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/index.ts"]
