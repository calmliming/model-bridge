/**
 * In-memory request limits for platform API keys (single-process app):
 *   - a sliding-window rate limit (requests per minute), and
 *   - a concurrency gate (max simultaneous in-flight requests).
 *
 * Both are keyed by API key id. State is process-local — fine for the SQLite /
 * single-node deployment this project targets; it resets on restart, which
 * only ever loosens a limit, never tightens it incorrectly.
 */

// ── Sliding-window rate limit (requests / minute) ──────────────────────────

const RATE_WINDOW_MS = 60_000
const rateHits = new Map<string, number[]>()

/**
 * Records a request against `key` and reports whether it is within
 * `limitPerMin`. Returns true when allowed (and counts the hit), false when
 * the per-minute limit is already reached (the hit is not counted).
 */
export function checkRateLimit(key: string, limitPerMin: number, now = Date.now()): boolean {
  const cutoff = now - RATE_WINDOW_MS
  const recent = (rateHits.get(key) ?? []).filter((t) => t > cutoff)
  if (recent.length >= limitPerMin) {
    rateHits.set(key, recent)
    return false
  }
  recent.push(now)
  rateHits.set(key, recent)
  return true
}

// ── Concurrency gate (max simultaneous requests) ───────────────────────────

const inflight = new Map<string, number>()

/**
 * Tries to take one concurrency slot for `key`. Returns true and increments
 * the in-flight count when below `limit`; returns false (no change) when the
 * limit is already reached. Every successful acquire must be paired with a
 * `releaseSlot` in a finally block.
 */
export function acquireSlot(key: string, limit: number): boolean {
  const current = inflight.get(key) ?? 0
  if (current >= limit) return false
  inflight.set(key, current + 1)
  return true
}

/** Releases one concurrency slot for `key`. Safe to call down to zero. */
export function releaseSlot(key: string): void {
  const current = inflight.get(key) ?? 0
  if (current <= 1) inflight.delete(key)
  else inflight.set(key, current - 1)
}

/** Current number of in-flight requests for `key` (0 when none). */
export function currentConcurrency(key: string): number {
  return inflight.get(key) ?? 0
}

/** Test helper: clears all rate-limit and concurrency state. */
export function resetLimits(): void {
  rateHits.clear()
  inflight.clear()
}
