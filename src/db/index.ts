import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { config } from '../config'
import * as schema from './schema'

const { Pool, types } = pg

// Return bigint columns as JS numbers (epoch ms / token counts fit in
// Number.MAX_SAFE_INTEGER for our workload — matching the previous SQLite
// behavior where INTEGER columns came back as numbers).
types.setTypeParser(types.builtins.INT8, (val) => Number(val))

/** Shared pg.Pool — also used by stats.ts / recorder.ts for raw SQL. */
export const pool = new Pool({ connectionString: config.DATABASE_URL })

/** Drizzle ORM client used throughout the app. */
export const db = drizzle(pool, { schema })

// Q2-B: warn loudly when a non-production process connects to a remote DB.
// Helps catch the "oops, my dev server just wrote to prod" footgun when the
// SSH tunnel is up.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0'])
try {
  const host = new URL(config.DATABASE_URL).hostname
  if (process.env.NODE_ENV !== 'production' && !LOCAL_HOSTS.has(host)) {
    const lines = [
      '╔════════════════════════════════════════════════════════════╗',
      '║  ⚠️  正在连接非本地数据库(疑似生产)                          ║',
      '╠════════════════════════════════════════════════════════════╣',
      `║  host:     ${host.padEnd(46)} ║`,
      `║  NODE_ENV: ${(process.env.NODE_ENV ?? '(unset)').padEnd(46)} ║`,
      '║  写操作会直接影响该数据库,请确认                              ║',
      '╚════════════════════════════════════════════════════════════╝',
    ]
    for (const line of lines) console.warn(line)
  }
} catch {
  // URL parsing failed — config schema will catch this earlier anyway.
}
