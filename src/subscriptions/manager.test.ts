import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ query: vi.fn() }))

vi.mock('../db/index', () => ({
  pool: { query: mocks.query, connect: vi.fn() },
}))

import { consumeSubscriptionUsage, rolledWindows } from './manager'

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

function billingSub(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    user_id: 'user_1',
    plan_id: 'plan_1',
    group_id: 'group_1',
    status: 'active',
    starts_at: 1,
    expires_at: 10 * MONTH,
    daily_window_start: 1,
    weekly_window_start: 1,
    monthly_window_start: 1,
    daily_usage_usd: 4,
    weekly_usage_usd: 8,
    monthly_usage_usd: 12,
    daily_limit_usd: 5,
    weekly_limit_usd: 10,
    monthly_limit_usd: 20,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

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

describe('consumeSubscriptionUsage', () => {
  it('locks the subscription and consumes a cost that fits every window', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [billingSub()], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })

    await expect(consumeSubscriptionUsage({ query: mocks.query } as never, 'sub_1', 1, 1000)).resolves.toBe(true)
    expect(mocks.query.mock.calls[0]?.[0]).toMatch(/FOR UPDATE OF s/)
    expect(mocks.query.mock.calls[1]?.[1]).toEqual([1, 5, 1, 9, 1, 13, 'sub_1'])
  })

  it('does not consume when one configured window lacks room', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [billingSub()], rowCount: 1 })

    await expect(consumeSubscriptionUsage({ query: mocks.query } as never, 'sub_1', 1.01, 1000)).resolves.toBe(false)
    expect(mocks.query).toHaveBeenCalledTimes(1)
  })

  it('uses rolled-over windows when deciding capacity', async () => {
    const now = 40 * DAY
    mocks.query
      .mockResolvedValueOnce({
        rows: [billingSub({
          daily_window_start: now - DAY,
          weekly_window_start: now - WEEK,
          monthly_window_start: now - MONTH,
        })],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })

    await expect(consumeSubscriptionUsage({ query: mocks.query } as never, 'sub_1', 5, now)).resolves.toBe(true)
    expect(mocks.query.mock.calls[1]?.[1]).toEqual([now, 5, now, 5, now, 5, 'sub_1'])
  })

  it('rejects an expired subscription without updating it', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [billingSub({ expires_at: 999 })], rowCount: 1 })

    await expect(consumeSubscriptionUsage({ query: mocks.query } as never, 'sub_1', 1, 1000)).resolves.toBe(false)
    expect(mocks.query).toHaveBeenCalledTimes(1)
  })
})
