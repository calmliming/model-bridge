const HOUR = 60 * 60_000
export const FIVE_HOURS = 5 * HOUR
export const WEEK = 7 * 24 * HOUR
/** A normalized model-weight unit, not a wallet balance or redeemable currency. */
export const USAGE_POINTS_PER_WEIGHT = 1000
export type SubscriptionQuotaMode = 'spend' | 'usage'

export interface UsageWindow {
  key: 'fiveHour' | 'weekly' | 'monthly'
  limit: number | null
  used: number
  remaining: number | null
  percent: number
  resetsAt: number | null
  startedAt: number | null
}

export function usagePoints(weightedCost: number): number {
  if (!Number.isFinite(weightedCost) || weightedCost < 0) throw new Error('usage weight must be finite and non-negative')
  return Math.round(weightedCost * USAGE_POINTS_PER_WEIGHT * 1_000_000) / 1_000_000
}

/** UTC calendar months anchored to the original subscription date, including Jan 31/leap years. */
export function monthBoundary(anchor: number, offset: number): number {
  const original = new Date(anchor)
  const date = new Date(anchor)
  date.setUTCDate(1)
  date.setUTCMonth(original.getUTCMonth() + offset)
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(original.getUTCDate(), lastDay))
  return date.getTime()
}

function calendarPeriod(anchor: number, now: number) {
  const startDate = new Date(anchor)
  const current = new Date(now)
  let offset = Math.max(0, (current.getUTCFullYear() - startDate.getUTCFullYear()) * 12 + current.getUTCMonth() - startDate.getUTCMonth())
  if (monthBoundary(anchor, offset) > now) offset = Math.max(0, offset - 1)
  return { start: monthBoundary(anchor, offset), end: monthBoundary(anchor, offset + 1) }
}

/** Five-hour sessions start with usage; weeks stay anchored; Waffo months use verified paid periods. */
export function subscriptionUsageWindows(row: Record<string, unknown>, now = Date.now()): UsageWindow[] {
  const anchor = Number(row.starts_at)
  const expiresAt = Number(row.expires_at)
  const fiveStart = row.five_hour_window_start == null ? null : Number(row.five_hour_window_start)
  const fiveCurrent = fiveStart != null && now < fiveStart + FIVE_HOURS
  const weekStart = anchor + Math.max(0, Math.floor((now - anchor) / WEEK)) * WEEK
  const period = row.billing_period_start != null && row.billing_period_end != null
    ? { start: Number(row.billing_period_start), end: Number(row.billing_period_end) }
    : calendarPeriod(anchor, now)
  const values = [
    { key: 'fiveHour' as const, limit: row.five_hour_limit_points, used: fiveCurrent ? Number(row.five_hour_usage_points ?? 0) : 0, start: fiveCurrent ? fiveStart : null, end: fiveCurrent ? fiveStart! + FIVE_HOURS : null },
    { key: 'weekly' as const, limit: row.weekly_limit_points, used: Number(row.weekly_points_start) === weekStart ? Number(row.weekly_usage_points ?? 0) : 0, start: weekStart, end: weekStart + WEEK },
    { key: 'monthly' as const, limit: row.monthly_limit_points, used: Number(row.monthly_points_start) === period.start ? Number(row.monthly_usage_points ?? 0) : 0, start: period.start, end: period.end },
  ]
  return values.map(value => {
    const limit = value.limit == null ? null : Number(value.limit)
    return {
      key: value.key, limit, used: value.used,
      remaining: limit == null ? null : Math.max(0, limit - value.used),
      percent: limit == null ? 0 : Math.min(100, Math.max(0, value.used / limit * 100)),
      startedAt: value.start,
      resetsAt: value.end == null ? null : Math.min(expiresAt, value.end),
    }
  })
}
