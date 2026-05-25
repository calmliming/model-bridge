// One-shot data migration: SQLite → PostgreSQL.
//
// Reads the old better-sqlite3 file (`DATABASE_PATH` or --sqlite) and
// writes every row into the PostgreSQL DB pointed at by `DATABASE_URL`
// (or --pg-url). Designed to be idempotent: refuses to write into a
// non-empty target table unless --force is set.
//
// Usage:
//   tsx scripts/migrate-sqlite-to-pg.ts \
//     --sqlite ./data/model-bridge.db \
//     --pg-url postgres://model_bridge:PW@127.0.0.1:5432/model_bridge \
//     [--force]
//
// All flags are optional — defaults come from .env.

import { config as loadDotenv } from 'dotenv'
import Database from 'better-sqlite3'
import pg from 'pg'

loadDotenv()

interface Args {
  sqlite: string
  pgUrl: string
  force: boolean
}

function parseArgs(): Args {
  const a = process.argv.slice(2)
  let sqlite = process.env.DATABASE_PATH ?? './data/model-bridge.db'
  let pgUrl = process.env.DATABASE_URL ?? ''
  let force = false
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--sqlite') sqlite = a[++i] ?? sqlite
    else if (a[i] === '--pg-url') pgUrl = a[++i] ?? pgUrl
    else if (a[i] === '--force') force = true
    else if (a[i] === '--help' || a[i] === '-h') {
      console.log(
        'usage: tsx scripts/migrate-sqlite-to-pg.ts [--sqlite path] [--pg-url url] [--force]',
      )
      process.exit(0)
    }
  }
  if (!pgUrl) {
    console.error('missing --pg-url (or DATABASE_URL in .env)')
    process.exit(1)
  }
  return { sqlite, pgUrl, force }
}

// Columns we copy, in stable order. Names match snake_case in both DBs.
const TABLES: { name: string; cols: string[]; transforms?: Record<string, (v: unknown) => unknown> }[] = [
  { name: 'settings', cols: ['key', 'value'] },
  {
    name: 'model_pricing',
    cols: ['id', 'provider', 'model', 'input_price', 'output_price', 'cache_write_price', 'cache_read_price'],
  },
  {
    name: 'accounts',
    cols: [
      'id', 'provider', 'name', 'oauth_access_token', 'oauth_refresh_token',
      'token_expires_at', 'status', 'cooldown_until', 'proxy_url', 'weight',
      'last_used_at', 'metadata', 'created_at',
    ],
    transforms: {
      // SQLite stores JSON as TEXT — parse so pg's JSONB driver re-encodes cleanly.
      metadata: (v) => (typeof v === 'string' && v.length > 0 ? JSON.parse(v) : v),
    },
  },
  {
    name: 'api_keys',
    cols: [
      'id', 'name', 'owner_label', 'key_hash', 'key_secret_encrypted', 'key_prefix',
      'enabled', 'allowed_providers', 'allowed_models', 'rate_limit',
      'quota_limit', 'quota_used', 'expires_at', 'last_used_at', 'created_at',
    ],
    transforms: {
      enabled: (v) => v === 1 || v === true || v === '1',
      allowed_providers: (v) => (typeof v === 'string' && v.length > 0 ? JSON.parse(v) : v),
      allowed_models: (v) => (typeof v === 'string' && v.length > 0 ? JSON.parse(v) : v),
    },
  },
  {
    name: 'oauth_sessions',
    cols: ['state', 'provider', 'code_verifier', 'account_name', 'created_at'],
  },
  {
    name: 'usage_logs',
    cols: [
      'id', 'api_key_id', 'account_id', 'provider', 'model', 'ts',
      'input_tokens', 'output_tokens', 'cache_create_tokens', 'cache_read_tokens',
      'cost', 'status', 'latency_ms',
    ],
  },
]

const BATCH = 1000

async function main(): Promise<void> {
  const args = parseArgs()
  console.log(`[migrate] sqlite: ${args.sqlite}`)
  console.log(`[migrate] pg:     ${new URL(args.pgUrl).hostname}`)

  const sqlite = new Database(args.sqlite, { readonly: true })
  const pgClient = new pg.Client({ connectionString: args.pgUrl })
  await pgClient.connect()

  try {
    for (const table of TABLES) {
      // Older SQLite databases may lack columns that were added later by
      // ensureColumn() (e.g. api_keys.key_secret_encrypted). Intersect the
      // expected column list with what actually exists, and let PG fill the
      // rest with its default values / NULL.
      const presentCols = (
        sqlite.prepare(`PRAGMA table_info(${table.name})`).all() as { name: string }[]
      ).map((c) => c.name)
      const cols = table.cols.filter((c) => presentCols.includes(c))
      const skipped = table.cols.filter((c) => !presentCols.includes(c))
      if (skipped.length) {
        console.log(`[migrate] ${table.name}: source missing columns ${skipped.join(', ')} — will use PG defaults`)
      }
      const srcRows = sqlite.prepare(`SELECT ${cols.join(', ')} FROM ${table.name}`).all() as Record<string, unknown>[]
      const { rows: [{ count }] } = await pgClient.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${table.name}`,
      )
      const existing = Number(count)
      if (existing > 0 && !args.force) {
        console.warn(`[migrate] ${table.name}: target has ${existing} rows, skipping (use --force to overwrite)`)
        continue
      }
      if (existing > 0 && args.force) {
        console.warn(`[migrate] ${table.name}: target has ${existing} rows, truncating (--force)`)
        await pgClient.query(`TRUNCATE TABLE ${table.name}`)
      }
      if (srcRows.length === 0) {
        console.log(`[migrate] ${table.name}: source empty, nothing to copy`)
        continue
      }

      const placeholders: string[] = []
      const params: unknown[] = []
      let written = 0
      for (let i = 0; i < srcRows.length; i++) {
        const row = srcRows[i]
        const rowPlaceholders: string[] = []
        for (const col of cols) {
          let val: unknown = row[col]
          const t = table.transforms?.[col]
          if (t) val = t(val)
          params.push(val)
          rowPlaceholders.push(`$${params.length}`)
        }
        placeholders.push(`(${rowPlaceholders.join(', ')})`)

        // Flush every BATCH rows OR on the last row.
        if (placeholders.length >= BATCH || i === srcRows.length - 1) {
          const sql = `INSERT INTO ${table.name} (${cols.join(', ')}) VALUES ${placeholders.join(', ')}`
          await pgClient.query(sql, params)
          written += placeholders.length
          placeholders.length = 0
          params.length = 0
        }
      }
      const { rows: [verify] } = await pgClient.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ${table.name}`,
      )
      const finalCount = Number(verify.count)
      const ok = finalCount === srcRows.length
      console.log(
        `[migrate] ${table.name}: copied ${written} rows (source ${srcRows.length}, target ${finalCount}) ${ok ? 'OK' : 'MISMATCH'}`,
      )
      if (!ok) throw new Error(`row count mismatch for ${table.name}`)
    }
    console.log('[migrate] done')
  } finally {
    await pgClient.end()
    sqlite.close()
  }
}

main().catch((err) => {
  console.error('[migrate] failed:', err)
  process.exit(1)
})
