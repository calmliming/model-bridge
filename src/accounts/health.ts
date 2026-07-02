/**
 * Per-account health score (0–100) derived from recent relay outcomes.
 *
 * The 4-state `accounts.status` (active/rate_limited/error/disabled) says what an
 * account is doing right now; it cannot tell you an account is *degrading* while
 * still nominally "active". This score fills that gap: it summarizes the recent
 * success rate and latency into one number so an operator can spot an account
 * that is still up but getting worse before it trips a cooldown.
 *
 * Purely data-driven from `usage_logs` — it does not read the live status. The
 * dashboard shows the status badge alongside this number.
 */

import { pool } from '../db/index'

/** Rolling window used to judge account health. */
const HEALTH_WINDOW_MS = 6 * 60 * 60_000 // 6 hours

// Latency penalty: none up to LAT_GOOD, ramping to LAT_MAX_PENALTY at LAT_BAD+.
const LAT_GOOD_MS = 3_000
const LAT_BAD_MS = 20_000
const LAT_MAX_PENALTY = 20

export interface AccountHealth {
  /** 0–100; null when there is no recent traffic to judge. */
  score: number | null
  /** Number of requests observed in the window (confidence indicator). */
  sampleSize: number
  successRate: number | null
  errorRate: number | null
  avgLatencyMs: number | null
}

export function emptyHealth(): AccountHealth {
  return { score: null, sampleSize: 0, successRate: null, errorRate: null, avgLatencyMs: null }
}

/**
 * Combines success rate and average latency into a 0–100 score. Success rate is
 * the dominant term (100 when everything succeeds); slow-but-successful accounts
 * are docked up to LAT_MAX_PENALTY points. Returns null when there is no data.
 */
export function scoreFromStats(
  total: number,
  success: number,
  avgLatencyMs: number | null,
): number | null {
  if (total <= 0) return null
  const successRate = Math.max(0, Math.min(1, success / total))
  let score = successRate * 100
  if (avgLatencyMs != null && avgLatencyMs > LAT_GOOD_MS) {
    const frac = Math.min(1, (avgLatencyMs - LAT_GOOD_MS) / (LAT_BAD_MS - LAT_GOOD_MS))
    score -= frac * LAT_MAX_PENALTY
  }
  return Math.max(0, Math.min(100, Math.round(score)))
}

/**
 * Batch-computes health for many accounts in one query (no N+1). Accounts with
 * no traffic in the window get an empty (null-score) entry so callers can rely
 * on every requested id being present in the map.
 */
export async function accountHealth(
  accountIds: string[],
  now = Date.now(),
): Promise<Map<string, AccountHealth>> {
  const result = new Map<string, AccountHealth>()
  if (!accountIds.length) return result
  const since = now - HEALTH_WINDOW_MS
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT account_id,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'success') AS success,
            AVG(latency_ms) FILTER (WHERE latency_ms IS NOT NULL) AS avg_latency
     FROM usage_logs
     WHERE account_id = ANY($1) AND ts >= $2
     GROUP BY account_id`,
    [accountIds, since],
  )
  for (const row of rows) {
    const id = row.account_id as string
    const total = Number(row.total ?? 0)
    const success = Number(row.success ?? 0)
    const avgLatencyMs = row.avg_latency == null ? null : Math.round(Number(row.avg_latency))
    result.set(id, {
      score: scoreFromStats(total, success, avgLatencyMs),
      sampleSize: total,
      successRate: total > 0 ? success / total : null,
      errorRate: total > 0 ? (total - success) / total : null,
      avgLatencyMs,
    })
  }
  for (const id of accountIds) {
    if (!result.has(id)) result.set(id, emptyHealth())
  }
  return result
}
