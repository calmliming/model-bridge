import { describe, expect, it } from 'vitest'
import { FIVE_HOURS, WEEK, monthBoundary, subscriptionUsageWindows, usagePoints } from './usageWindows'

const anchor = Date.parse('2026-01-31T12:00:00Z')
function row(patch: Record<string, unknown> = {}) {
  return { starts_at: anchor, expires_at: anchor + 100 * 86_400_000,
    five_hour_limit_points: 2000, weekly_limit_points: 10000, monthly_limit_points: 30000,
    five_hour_window_start: anchor, five_hour_usage_points: 500,
    weekly_points_start: anchor, weekly_usage_points: 2500,
    monthly_points_start: anchor, monthly_usage_points: 3000, ...patch }
}

describe('weighted subscription windows', () => {
  it('shares weighted usage in all three independent windows', () => {
    const windows = subscriptionUsageWindows(row(), anchor + 1000)
    expect(windows.map(window => window.percent)).toEqual([25, 25, 10])
    expect(windows.map(window => window.remaining)).toEqual([1500, 7500, 27000])
  })
  it('starts the five-hour timer with the first usage instead of purchase', () => {
    const [five] = subscriptionUsageWindows(row({ five_hour_window_start: null, five_hour_usage_points: 0 }), anchor + 86_400_000)
    expect(five).toMatchObject({ used: 0, startedAt: null, resetsAt: null })
  })
  it('resets only the five-hour window at its exact boundary', () => {
    const [five, week, month] = subscriptionUsageWindows(row(), anchor + FIVE_HOURS)
    expect(five).toMatchObject({ used: 0, startedAt: null, resetsAt: null })
    expect(week.used).toBe(2500)
    expect(month.used).toBe(3000)
  })
  it('keeps the weekly reset anchor even after weeks without activity', () => {
    const [, week] = subscriptionUsageWindows(row(), anchor + 3 * WEEK + 1000)
    expect(week).toMatchObject({ used: 0, startedAt: anchor + 3 * WEEK, resetsAt: anchor + 4 * WEEK })
  })
  it('uses paid billing dates instead of an assumed 30 days', () => {
    const start = Date.parse('2026-02-28T12:00:00Z')
    const end = Date.parse('2026-03-28T12:00:00Z')
    const [, , month] = subscriptionUsageWindows(row({ billing_period_start: start, billing_period_end: end, monthly_points_start: start }), start + 1000)
    expect(month).toMatchObject({ used: 3000, startedAt: start, resetsAt: end })
  })
  it('does not reset monthly usage on duplicate same-period webhook updates', () => {
    const [, , month] = subscriptionUsageWindows(row({ billing_period_start: anchor, billing_period_end: anchor + 28 * 86_400_000 }), anchor + 1000)
    expect(month.used).toBe(3000)
  })
  it('resets the monthly window on a new paid period without resetting the weekly counter', () => {
    const start = Date.parse('2026-02-28T12:00:00Z')
    const weeklyStart = anchor + 4 * WEEK
    const [, week, month] = subscriptionUsageWindows(row({ weekly_points_start: weeklyStart, billing_period_start: start, billing_period_end: Date.parse('2026-03-28T12:00:00Z') }), start + 1000)
    expect(week.used).toBe(2500)
    expect(month.used).toBe(0)
  })
  it('retains settled in-flight overage while clamping the displayed percentage', () => {
    const [five] = subscriptionUsageWindows(row({ five_hour_usage_points: 2050 }), anchor + 1000)
    expect(five).toMatchObject({ used: 2050, remaining: 0, percent: 100 })
  })
  it('does not promise a reset beyond the end of the paid subscription', () => {
    const windows = subscriptionUsageWindows(row({ expires_at: anchor + 10000 }), anchor + 1000)
    expect(windows.every(window => window.resetsAt === anchor + 10000)).toBe(true)
  })
  it('preserves month-end anchors across February and leap years', () => {
    expect(monthBoundary(anchor, 1)).toBe(Date.parse('2026-02-28T12:00:00Z'))
    expect(monthBoundary(anchor, 2)).toBe(Date.parse('2026-03-31T12:00:00Z'))
    expect(monthBoundary(Date.parse('2024-01-31T12:00:00Z'), 1)).toBe(Date.parse('2024-02-29T12:00:00Z'))
  })
  it('retains small cache charges and rejects invalid weights', () => {
    expect(usagePoints(0.0000001)).toBe(0.0001)
    for (const value of [-1, Infinity, NaN]) expect(() => usagePoints(value)).toThrow()
  })
})
