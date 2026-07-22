import { ne } from 'drizzle-orm'
import { db } from '../db/index'
import { accounts } from '../db/schema'
import { getRedis } from '../store/redis'
import { getQuotaAutopausePercent } from '../db/settings'
import { accountQuotaFromMetadata, quotaPauseUntil, resolveAutopausePercent } from '../accounts/quota'
import { penalizeAccount } from '../accounts/scheduler'

const CHECK_INTERVAL_MS = 60_000
// 多实例部署时用 Redis 锁，保证每个周期只有一个节点执行扫描。
const SWEEP_LOCK_KEY = 'mb:lock:quota-autopause'
const SWEEP_LOCK_TTL_MS = 50_000

async function acquireSweepLock(): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return true
  try {
    const res = await redis.set(SWEEP_LOCK_KEY, '1', 'PX', SWEEP_LOCK_TTL_MS, 'NX')
    return res === 'OK'
  } catch {
    // Redis 异常时退化为本节点执行，停调宁可多做也不漏做。
    return true
  }
}

/**
 * 周期性复核每个未禁用账号最近一次缓存的配额快照，将达到自动停调阈值的账号
 * 置入 cooldown，直到触发窗口重置。relay / 手动测试已经覆盖「在用账号」的即时
 * 停调；本扫描额外兜底两种情况：① 闲置账号（不会被请求触发复核）；② 管理员
 * 下调全局阈值后，需要无流量也能让已超阈值的账号立即停调。
 *
 * 只读快照、不调用上游：快照里 resetAt 已过期的窗口会被 quotaPauseUntil 忽略，
 * 因此不会因陈旧数据把账号永久停调。
 */
async function sweepQuotaAutopause(now = Date.now()): Promise<void> {
  if (!(await acquireSweepLock())) return
  const globalPercent = await getQuotaAutopausePercent()
  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      status: accounts.status,
      cooldownUntil: accounts.cooldownUntil,
      metadata: accounts.metadata,
    })
    .from(accounts)
    .where(ne(accounts.status, 'disabled'))

  for (const account of rows) {
    const quota = accountQuotaFromMetadata(account.metadata)
    if (!quota) continue
    const threshold = resolveAutopausePercent(account.metadata, globalPercent)
    const pauseUntil = quotaPauseUntil(quota, threshold, now)
    if (!pauseUntil) continue
    // 已经因相同（或更晚）的窗口重置而停调，无需每周期重复写库。
    if (account.status === 'rate_limited' && account.cooldownUntil && account.cooldownUntil >= pauseUntil) {
      continue
    }
    try {
      await penalizeAccount(account.id, 'rate_limited', pauseUntil)
    } catch (err) {
      console.error(`[quota-autopause] failed for "${account.name}":`, (err as Error).message)
    }
  }
}

/** 启动后台循环，持续按阈值自动停调超额账号。 */
export function startQuotaAutopauseJob(): () => Promise<void> {
  let running: Promise<void> | null = null
  const timer = setInterval(() => {
    if (running) return
    running = sweepQuotaAutopause()
      .catch((err) => {
        console.error('[quota-autopause] job failed:', (err as Error).message)
      })
      .finally(() => {
        running = null
      })
  }, CHECK_INTERVAL_MS)

  return async () => {
    clearInterval(timer)
    await running
  }
}
