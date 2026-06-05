import { describe, expect, it } from 'vitest'
import { rolledWindows } from './manager'

/**
 * rolledWindows is the pure core of the subscription engine: it decides, per
 * read, whether each usage window has aged past its period and must reset to
 * zero. The billing gate and usage accrual both depend on it being correct.
 */

const DAY = 24 * 60 * 60_000
const WEEK = 7 * DAY
const MONTH = 30 * DAY

function sub(overrides: Record<string, number>) {
  const base = {
    daily_window_start: 0,
    weekly_window_start: 0,
    monthly_window_start: 0,
    daily_usage_usd: 5,
    weekly_usage_usd: 20,
    monthly_usage_usd: 50,
  }
  return { ...base, ...overrides } as never
}

describe('rolledWindows', () => {
  it('keeps usage within an unexpired window', () => {
    const now = 1000
    const w = rolledWindows(sub({ daily_window_start: now - DAY / 2 }), now)
    expect(w.daily.usage).toBe(5)
    expect(w.daily.start).toBe(now - DAY / 2)
  })

  it('resets the daily window once a full day has elapsed', () => {
    const now = 10 * DAY
    const w = rolledWindows(sub({ daily_window_start: now - DAY }), now)
    expect(w.daily.usage).toBe(0)
    expect(w.daily.start).toBe(now)
  })

  it('resets each window independently on its own period', () => {
    const now = 100 * DAY
    const w = rolledWindows(
      sub({
        daily_window_start: now - DAY, // aged → reset
        weekly_window_start: now - WEEK / 2, // fresh → keep
        monthly_window_start: now - MONTH, // aged → reset
      }),
      now,
    )
    expect(w.daily.usage).toBe(0)
    expect(w.weekly.usage).toBe(20)
    expect(w.monthly.usage).toBe(0)
  })

  it('treats exactly one period elapsed as expired (>=)', () => {
    const now = 50 * DAY
    const w = rolledWindows(sub({ weekly_window_start: now - WEEK }), now)
    expect(w.weekly.usage).toBe(0)
  })
})
