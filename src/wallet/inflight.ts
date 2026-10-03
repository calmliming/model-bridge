/**
 * Balance-mode in-flight reservations.
 *
 * Admission only checks that the wallet balance is positive, so several
 * expensive requests started together can all pass and settle into debt.
 * When enabled, each balance-billed request reserves a conservative cost
 * estimate; a new request is admitted only while
 *   balance - sum(other live reservations) >= its own estimate.
 * The first in-flight request is always admitted (the positive-balance check
 * already ran). Reservations are released when the request finishes — after
 * usage has been settled — and expire by TTL if a process dies mid-request.
 *
 * Shares state through Redis when REDIS_URL is configured and falls back to
 * process memory otherwise. Store errors fail open, matching the other limits.
 */

import { randomUUID } from 'node:crypto'
import { getRedis } from '../store/redis'
import { resolvePrice } from '../usage/pricing'
import { usdToMicros } from './money'

export const INFLIGHT_RESERVATION_TTL_MS = 15 * 60_000
const MAX_ESTIMATED_INPUT_TOKENS = 200_000
const MAX_ESTIMATED_OUTPUT_TOKENS = 128_000

export type InflightRelease = () => Promise<void>

export const noopRelease: InflightRelease = async () => undefined

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null
}

/** The output cap the request declares in any supported protocol. */
function requestedOutputTokens(body: Record<string, unknown>): number | null {
  const generationConfig = body.generationConfig
  const gemini = generationConfig && typeof generationConfig === 'object' && !Array.isArray(generationConfig)
    ? (generationConfig as Record<string, unknown>).maxOutputTokens : undefined
  return positiveInt(body.max_completion_tokens) ?? positiveInt(body.max_output_tokens) ??
    positiveInt(body.max_tokens) ?? positiveInt(gemini)
}

/**
 * Conservative cost estimate in micros: (body bytes / 4) input tokens plus the
 * declared (or default) output cap, at the model's base price and the key's
 * group multiplier. Returns null when the model has no price, so the caller
 * admits without a reservation instead of guessing.
 */
export function estimateReservationMicros(input: {
  provider: string
  model: string
  body: Record<string, unknown>
  bodyBytes: number
  multiplier: number
  defaultOutputTokens: number
}): number | null {
  const price = resolvePrice(input.provider, input.model)
  if (!price || !(input.multiplier > 0)) return null
  if (price.imageRequest != null) return usdToMicros(price.imageRequest * (positiveInt(input.body.n) ?? 1) * input.multiplier)
  const inputTokens = Math.min(Math.ceil(Math.max(0, input.bodyBytes) / 4), MAX_ESTIMATED_INPUT_TOKENS)
  const outputTokens = Math.min(requestedOutputTokens(input.body) ?? input.defaultOutputTokens, MAX_ESTIMATED_OUTPUT_TOKENS)
  const usd = (inputTokens * price.input + outputTokens * price.output) / 1_000_000 * input.multiplier
  return Number.isFinite(usd) && usd > 0 ? usdToMicros(usd) : null
}

// ── Memory backend ───────────────────────────────────────────────────────────

const memory = new Map<string, Map<string, { micros: number; expiresAt: number }>>()

function memReserve(userId: string, balanceMicros: number, estimateMicros: number, member: string, now: number, ttlMs: number): boolean {
  const entries = memory.get(userId) ?? new Map<string, { micros: number; expiresAt: number }>()
  let reserved = 0
  for (const [id, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(id)
    else reserved += entry.micros
  }
  if (reserved > 0 && balanceMicros - reserved < estimateMicros) {
    if (!entries.size) memory.delete(userId)
    return false
  }
  entries.set(member, { micros: estimateMicros, expiresAt: now + ttlMs })
  memory.set(userId, entries)
  return true
}

function memRelease(userId: string, member: string): void {
  const entries = memory.get(userId)
  if (!entries) return
  entries.delete(member)
  if (!entries.size) memory.delete(userId)
}

// ── Redis backend ────────────────────────────────────────────────────────────

const reservationKey = (userId: string) => `mb:inflight:${userId}`

// Atomic purge-sum-check-insert over a hash of member → "micros:expiresAt".
const RESERVE_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local balance = tonumber(ARGV[2])
local estimate = tonumber(ARGV[3])
local member = ARGV[4]
local ttl = tonumber(ARGV[5])
local entries = redis.call('HGETALL', key)
local reserved = 0
for i = 1, #entries, 2 do
  local value = entries[i + 1]
  local sep = string.find(value, ':', 1, true)
  local amount = tonumber(string.sub(value, 1, sep - 1))
  local expires = tonumber(string.sub(value, sep + 1))
  if expires <= now then
    redis.call('HDEL', key, entries[i])
  else
    reserved = reserved + amount
  end
end
if reserved > 0 and balance - reserved < estimate then
  return 0
end
redis.call('HSET', key, member, estimate .. ':' .. (now + ttl))
redis.call('PEXPIRE', key, ttl)
return 1
`

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Reserves `estimateMicros` against the user's balance. Returns a release
 * function when admitted, or null when other in-flight reservations leave too
 * little balance for this request.
 */
export async function reserveInflightBalance(
  userId: string,
  balanceMicros: number,
  estimateMicros: number,
  now = Date.now(),
  ttlMs = INFLIGHT_RESERVATION_TTL_MS,
): Promise<InflightRelease | null> {
  if (!(estimateMicros > 0)) return noopRelease
  const member = randomUUID()
  const amount = Math.ceil(estimateMicros)
  const redis = getRedis()
  if (!redis) {
    if (!memReserve(userId, balanceMicros, amount, member, now, ttlMs)) return null
    return async () => memRelease(userId, member)
  }
  try {
    const admitted = await redis.eval(RESERVE_SCRIPT, 1, reservationKey(userId), now, balanceMicros, amount, member, ttlMs)
    if (Number(admitted) !== 1) return null
  } catch (err) {
    console.error('[inflight] redis reservation failed, admitting request:', (err as Error).message)
    return noopRelease
  }
  return async () => {
    try {
      await redis.hdel(reservationKey(userId), member)
    } catch (err) {
      // The TTL frees it; never fail the request over a release error.
      console.error('[inflight] redis release failed:', (err as Error).message)
    }
  }
}

/** Test helper: drops all in-memory reservations. */
export function resetInflightReservations(): void {
  memory.clear()
}
