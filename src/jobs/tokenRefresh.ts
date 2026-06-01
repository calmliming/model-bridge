import { ne } from 'drizzle-orm'
import { db } from '../db/index'
import { accounts } from '../db/schema'
import { refreshAccountToken } from '../accounts/manager'
import { getRedis } from '../store/redis'

const CHECK_INTERVAL_MS = 60_000
const REFRESH_AHEAD_MS = 5 * 60_000
// 多实例部署时，用这个 Redis 锁保证每个周期只有一个节点执行刷新，
// 避免多个副本同时对同一账户刷新 token。锁的存活时间略短于检查周期。
const REFRESH_LOCK_KEY = 'mb:lock:token-refresh'
const REFRESH_LOCK_TTL_MS = 50_000

/**
 * 尝试获取本周期的刷新锁。未配置 Redis（单节点）时直接返回 true；
 * 配置了 Redis 时用 SET NX PX 抢锁，只有抢到的节点才执行刷新。
 */
async function acquireRefreshLock(): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return true
  try {
    const res = await redis.set(REFRESH_LOCK_KEY, '1', 'PX', REFRESH_LOCK_TTL_MS, 'NX')
    return res === 'OK'
  } catch {
    // Redis 异常时退化为本节点执行，宁可多刷也不要漏刷。
    return true
  }
}

/** 刷新所有临近过期的账户 OAuth token。 */
async function refreshExpiringTokens(): Promise<void> {
  if (!(await acquireRefreshLock())) return
  const threshold = Date.now() + REFRESH_AHEAD_MS
  const rows = await db.select().from(accounts).where(ne(accounts.status, 'disabled'))
  for (const account of rows) {
    if (!account.tokenExpiresAt || account.tokenExpiresAt > threshold) continue
    if (!account.oauthRefreshToken) continue
    try {
      await refreshAccountToken(account.id)
      console.log(`[token-refresh] refreshed account "${account.name}"`)
    } catch (err) {
      console.error(`[token-refresh] failed for "${account.name}":`, (err as Error).message)
    }
  }
}

/** 启动后台循环，持续保持账户 token 新鲜。 */
export function startTokenRefreshJob(): void {
  setInterval(() => {
    void refreshExpiringTokens()
  }, CHECK_INTERVAL_MS)
}
