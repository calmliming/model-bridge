import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { APP_ENV, config, ENV_PATH } from '../config'
import * as schema from './schema'

const { Pool, types } = pg

// Return bigint columns as JS numbers (epoch ms / token counts fit in
// Number.MAX_SAFE_INTEGER for our workload — matching the previous SQLite
// behavior where INTEGER columns came back as numbers).
types.setTypeParser(types.builtins.INT8, (val) => Number(val))

/** Shared pg.Pool — also used by stats.ts / recorder.ts for raw SQL. */
export const pool = new Pool({ connectionString: config.DATABASE_URL, connectionTimeoutMillis: 5_000 })

/** Drizzle ORM client used throughout the app. */
export const db = drizzle(pool, { schema })

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0'])

/**
 * 本地/线上的数据库隔离闸门。
 *
 * 本地开发（APP_ENV=local）要连本地容器库；一旦发现 DATABASE_URL 指向远端
 * 主机，说明配置串了——这正是"本地调试顺手改了生产数据"的经典事故。
 * 这种情况下不再只是打印警告，而是直接拒绝启动，必须显式设置
 * ALLOW_REMOTE_DB=true 才放行（给"确实要本地连远端库"的少数场景留出口）。
 *
 * 线上模式（容器内 NODE_ENV=production）不设限，仅正常打印一行目标库信息。
 */
function assertSafeDatabaseTarget(): void {
  let host: string
  try {
    host = new URL(config.DATABASE_URL).hostname
  } catch {
    // URL 解析失败由 config 的 zod 校验提前拦下，这里无需再报。
    return
  }

  const isRemote = !LOCAL_HOSTS.has(host)
  if (APP_ENV === 'local') {
    if (!isRemote || config.ALLOW_REMOTE_DB) {
      console.log(`[db] env=${APP_ENV} (${ENV_PATH}) → ${host}${isRemote ? ' (远端库，已显式放行)' : ''}`)
      return
    }

    const lines = [
      '╔════════════════════════════════════════════════════════════════════╗',
      '║  已阻止启动：本地模式检测到远端数据库                                ║',
      '╠════════════════════════════════════════════════════════════════════╣',
      `║  DATABASE_URL host : ${host.padEnd(44)} ║`,
      `║  环境文件          : ${ENV_PATH.padEnd(44)} ║`,
      '║                                                                    ║',
      '║  本地开发应当连接本地容器库，而不是线上库：                          ║',
      '║    npm run dev:db     # 起本地 PostgreSQL（127.0.0.1:5433）         ║',
      '║                                                                    ║',
      '║  若确实需要本地连远端库，请在配置里显式设置：                        ║',
      '║    ALLOW_REMOTE_DB=true                                            ║',
      '║  注意：该模式下所有写操作会真实作用在远端库上。                      ║',
      '╚════════════════════════════════════════════════════════════════════╝',
    ]
    for (const line of lines) console.error(line)
    process.exit(1)
  }

  console.log(`[db] env=${APP_ENV} (${ENV_PATH}) → ${host}`)
}

assertSafeDatabaseTarget()
