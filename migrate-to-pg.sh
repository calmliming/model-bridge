#!/usr/bin/env bash
#
# One-click migration from the old SQLite database (./data/model-bridge.db)
# to the new bundled PostgreSQL container.
#
# Safe to run multiple times: the underlying migration script refuses to
# overwrite a non-empty target unless --force is passed, and this script
# backs the SQLite file up before doing anything.
#
set -euo pipefail

cd "$(dirname "$0")"

# ── 0. Sanity ────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  echo "✗ docker not found." >&2
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DC=(docker-compose)
else
  echo "✗ Docker Compose not found." >&2
  exit 1
fi

SQLITE_PATH="./data/model-bridge.db"
if [ ! -f "$SQLITE_PATH" ]; then
  echo "✗ no SQLite database found at $SQLITE_PATH"
  echo "  nothing to migrate — if this is a fresh install, just run ./install.sh"
  exit 1
fi

if [ ! -f .env ]; then
  echo "✗ .env not found. Run ./install.sh first to generate it."
  exit 1
fi

# Load PG_USER / PG_DATABASE / PG_PASSWORD from .env into this shell so the
# psql readiness probe below can authenticate.
set -a
# shellcheck disable=SC1091
. ./.env
set +a

if [ -z "${PG_PASSWORD:-}" ] || [ -z "${DATABASE_URL:-}" ]; then
  echo "✗ .env is missing PG_PASSWORD or DATABASE_URL."
  echo "  Re-run ./install.sh to top it up, then try again."
  exit 1
fi

# ── 1. Backup the SQLite file ────────────────────────────────────
TS=$(date -u +%Y%m%d-%H%M%S)
BACKUP="${SQLITE_PATH}.bak-${TS}"
echo "→ backing up SQLite to ${BACKUP}"
cp "$SQLITE_PATH" "$BACKUP"

# ── 2. Bring up PostgreSQL only and wait for it to be healthy ────
echo "→ starting postgres container"
"${DC[@]}" up -d postgres

echo "→ waiting for postgres to become healthy (up to 60s)"
for i in $(seq 1 30); do
  status=$("${DC[@]}" ps --format json postgres 2>/dev/null | grep -o '"Health":"[^"]*"' | head -n1 || true)
  if [[ "$status" == *"healthy"* ]]; then
    echo "  → postgres is healthy"
    break
  fi
  if [ "$i" = "30" ]; then
    echo "✗ postgres did not become healthy in 60s. Check '${DC[*]} logs postgres'." >&2
    exit 1
  fi
  sleep 2
done

# ── 3. Build the backend image (if not built) ────────────────────
# The migration script runs inside the backend image because that's where
# tsx + better-sqlite3 + pg are all installed.
echo "→ building model-bridge image (cached if unchanged)"
"${DC[@]}" build model-bridge

# ── 4. Create tables in PostgreSQL ───────────────────────────────
# Start the backend briefly so initDb() runs the CREATE TABLE IF NOT EXISTS
# statements, then stop it again before we import data.
echo "→ creating tables in postgres"
"${DC[@]}" up -d model-bridge
for i in $(seq 1 30); do
  if "${DC[@]}" exec -T postgres \
    psql -U "${PG_USER:-model_bridge}" -d "${PG_DATABASE:-model_bridge}" \
    -c "SELECT 1 FROM accounts LIMIT 1" >/dev/null 2>&1
  then
    echo "  → tables ready"
    break
  fi
  if [ "$i" = "30" ]; then
    echo "✗ tables didn't appear in 30s. Check '${DC[*]} logs model-bridge'." >&2
    exit 1
  fi
  sleep 1
done
"${DC[@]}" stop model-bridge >/dev/null

# ── 5. Run the migration script in the backend container ─────────
echo "→ importing data from SQLite into postgres"
# The container sees the host's ./data as /app/data. We force --force so
# the migration is idempotent against the empty tables we just created
# (every table technically has 0 rows, but model_pricing may have been
# seeded by initDb in some setups — --force truncates and re-inserts).
"${DC[@]}" run --rm \
  -e DATABASE_PATH=/app/data/$(basename "$BACKUP") \
  model-bridge \
  npx tsx scripts/migrate-sqlite-to-pg.ts --force

# ── 6. Bring the full stack up ───────────────────────────────────
echo "→ starting full stack"
"${DC[@]}" up -d

echo
echo "✔ migration complete"
echo "  dashboard:  http://localhost:3001"
echo "  backup:     ${BACKUP}  (keep this until you've verified everything works)"
echo
echo "Verify in the dashboard:"
echo "  - account list shows all upstream accounts"
echo "  - API keys list is complete"
echo "  - recent usage logs render"
echo
echo "Stop:   ${DC[*]} down"
echo "Logs:   ${DC[*]} logs -f model-bridge"
