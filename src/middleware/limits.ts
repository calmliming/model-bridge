/**
 * 按 API key 维度的请求限制：
 *   - 滑动窗口限流（每分钟请求数），以及
 *   - 并发门（同时在途请求的上限）。
 *
 * 两者都以 API key id 为键。后端可插拔：
 *   - 未配置 REDIS_URL → 进程内 Map（单节点；重启即清零，这只会放宽限制，
 *     不会错误地收紧）。
 *   - 配置了 REDIS_URL → 共享 Redis 状态，限制在负载均衡后的所有副本间统一生效。
 *
 * 所有辅助函数都是 async，因为 Redis 后端是异步的。Redis 不可达时它们选择
 * fail OPEN（放行请求），而不是阻塞流量。
 */

import { getRedis } from '../store/redis'

const RATE_WINDOW_MS = 60_000
/** 并发计数器的安全过期时间：防止进程崩溃后永久泄漏一个槽位。
 * 足够覆盖长时间的流式响应；泄漏的槽位在这段空闲窗口后会自动清除。 */
const CONCURRENCY_TTL_S = 15 * 60

// ── 内存后端 ────────────────────────────────────────────────────────────────

const rateHits = new Map<string, number[]>()
const inflight = new Map<string, number>()

export interface WindowLimitResult {
  allowed: boolean
  /** Milliseconds until the oldest hit leaves the window; zero when allowed. */
  retryAfterMs: number
}

function rateBucketKey(key: string, windowMs: number): string {
  return `${windowMs}:${key}`
}

function memCheckWindowLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): WindowLimitResult {
  const bucket = rateBucketKey(key, windowMs)
  const cutoff = now - windowMs
  const recent = (rateHits.get(bucket) ?? []).filter((t) => t > cutoff)
  if (recent.length >= limit) {
    rateHits.set(bucket, recent)
    return { allowed: false, retryAfterMs: Math.max(1, recent[0] + windowMs - now) }
  }
  recent.push(now)
  rateHits.set(bucket, recent)
  return { allowed: true, retryAfterMs: 0 }
}

function memAcquireSlot(key: string, limit: number): boolean {
  const current = inflight.get(key) ?? 0
  if (current >= limit) return false
  inflight.set(key, current + 1)
  return true
}

function memReleaseSlot(key: string): void {
  const current = inflight.get(key) ?? 0
  if (current <= 1) inflight.delete(key)
  else inflight.set(key, current - 1)
}

function memCurrentConcurrency(key: string): number {
  return inflight.get(key) ?? 0
}

// ── Redis 后端 ───────────────────────────────────────────────────────────────

const rateKey = (key: string, windowMs: number) => `mb:rl:${windowMs}:${key}`
const concKey = (key: string) => `mb:cc:${key}`

// 用按时间戳打分的有序集合实现滑动窗口限流。原子地「检查+写入」，
// 这样并发的多个副本不会同时越过限制。
const RATE_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry = window
  if oldest[2] then
    retry = math.max(1, tonumber(oldest[2]) + window - now)
  end
  return {0, retry}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return {1, 0}
`

// 并发门的原子「检查+自增」，带安全 TTL，避免持有者崩溃后把计数器
// 永久卡在零以上。
const ACQUIRE_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local cur = tonumber(redis.call('GET', key) or '0')
if cur >= limit then
  return 0
end
local v = redis.call('INCR', key)
redis.call('EXPIRE', key, ttl)
return 1
`

const RELEASE_SCRIPT = `
local key = KEYS[1]
local v = redis.call('DECR', key)
if v <= 0 then
  redis.call('DEL', key)
end
return 1
`

let memberSeq = 0

// ── 对外 API（异步，与后端无关）────────────────────────────────────────────────

/**
 * Records a request against `key` and reports whether it is within
 * `limitPerMin`. Returns true when allowed (and counts the hit), false when
 * the per-minute limit is already reached (the hit is not counted).
 */
export async function checkWindowLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): Promise<WindowLimitResult> {
  const safeLimit = Math.max(1, Math.trunc(limit))
  const safeWindow = Math.max(1, Math.trunc(windowMs))
  const redis = getRedis()
  if (!redis) return memCheckWindowLimit(key, safeLimit, safeWindow, now)
  try {
    const member = `${now}-${process.pid}-${memberSeq++}`
    const res = await redis.eval(
      RATE_SCRIPT,
      1,
      rateKey(key, safeWindow),
      String(now),
      String(safeWindow),
      String(safeLimit),
      member,
    ) as [number, number]
    return { allowed: res[0] === 1, retryAfterMs: Number(res[1]) || 0 }
  } catch (err) {
    console.error('[limits] redis rate-limit failed, allowing request:', (err as Error).message)
    return { allowed: true, retryAfterMs: 0 } // fail open：放行
  }
}

/** Backward-compatible one-minute boolean rate-limit API used by relay/auth. */
export async function checkRateLimit(
  key: string,
  limitPerMin: number,
  now = Date.now(),
): Promise<boolean> {
  return (await checkWindowLimit(key, limitPerMin, RATE_WINDOW_MS, now)).allowed
}

/**
 * Tries to take one concurrency slot for `key`. Returns true and increments
 * the in-flight count when below `limit`; returns false (no change) when the
 * limit is already reached. Every successful acquire must be paired with a
 * `releaseSlot` in a finally block.
 */
export async function acquireSlot(key: string, limit: number): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return memAcquireSlot(key, limit)
  try {
    const res = await redis.eval(
      ACQUIRE_SCRIPT,
      1,
      concKey(key),
      String(limit),
      String(CONCURRENCY_TTL_S),
    )
    return res === 1
  } catch (err) {
    console.error('[limits] redis acquire failed, allowing request:', (err as Error).message)
    return true // fail open：放行
  }
}

/** Releases one concurrency slot for `key`. Safe to call down to zero. */
export async function releaseSlot(key: string): Promise<void> {
  const redis = getRedis()
  if (!redis) {
    memReleaseSlot(key)
    return
  }
  try {
    await redis.eval(RELEASE_SCRIPT, 1, concKey(key))
  } catch (err) {
    console.error('[limits] redis release failed:', (err as Error).message)
  }
}

/** Current number of in-flight requests for `key` (0 when none). */
export async function currentConcurrency(key: string): Promise<number> {
  const redis = getRedis()
  if (!redis) return memCurrentConcurrency(key)
  try {
    const raw = await redis.get(concKey(key))
    return raw ? Number(raw) : 0
  } catch {
    return 0
  }
}

/** Test helper: clears all in-memory rate-limit and concurrency state. */
export async function resetLimits(): Promise<void> {
  rateHits.clear()
  inflight.clear()
}
