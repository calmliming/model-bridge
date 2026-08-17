import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  resolvePrice: vi.fn(() => null),
}))

vi.mock('../db/index', () => ({
  pool: { query: mocks.query },
}))

vi.mock('./pricing', () => ({
  resolvePrice: mocks.resolvePrice,
}))

import { dailyStats, dashboardRecentLogs } from './stats'
import { config } from '../config'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.query.mockImplementation(async (sql: string) => {
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ total: '0' }] }
    return { rows: [] }
  })
})

describe('dashboardRecentLogs', () => {
  it('applies provider, model, and key filters to the recent logs query', async () => {
    await dashboardRecentLogs(2, 25, {
      provider: 'openai',
      model: 'gpt-5',
      key: 'workstation',
    })

    expect(mocks.query).toHaveBeenCalledTimes(2)
    expect(mocks.query.mock.calls[0][0]).toContain('WHERE usage_logs.provider = $1 AND usage_logs.model ILIKE $2')
    expect(mocks.query.mock.calls[0][0]).toContain('api_keys.name ILIKE $3')
    expect(mocks.query.mock.calls[0][1]).toEqual(['openai', '%gpt-5%', '%workstation%'])
    expect(mocks.query.mock.calls[1][0]).toContain('LIMIT $4 OFFSET $5')
    expect(mocks.query.mock.calls[1][1]).toEqual(['openai', '%gpt-5%', '%workstation%', 25, 25])
  })

  it('filters failed and model-mismatch records without interpolating values', async () => {
    await dashboardRecentLogs(1, 20, { status: 'error', modelMismatch: true })

    expect(mocks.query.mock.calls[0][0]).toContain('usage_logs.status = $1')
    expect(mocks.query.mock.calls[0][0]).toContain('usage_logs.model_mismatch = $2')
    expect(mocks.query.mock.calls[0][1]).toEqual(['error', true])
    expect(mocks.query.mock.calls[1][1]).toEqual(['error', true, 20, 0])
  })

  it('resolves historical prices at the usage-log timestamp', async () => {
    const ts = Date.parse('2026-08-17T01:30:00Z')
    mocks.query.mockImplementation(async (sql: string) => {
      if (/COUNT\(\*\)/.test(sql)) return { rows: [{ total: '1' }] }
      return {
        rows: [{
          id: 'usage-1',
          ts,
          provider: 'deepseek',
          model: 'deepseek-v4-pro',
          status: 'success',
          attemptcount: 1,
        }],
      }
    })

    await dashboardRecentLogs(1, 10)

    expect(mocks.resolvePrice).toHaveBeenCalledWith('deepseek', 'deepseek-v4-pro', ts)
  })
})

describe('dailyStats', () => {
  it('buckets days by the configured stats timezone, not the DB session timezone', async () => {
    mocks.query.mockResolvedValue({ rows: [] })

    const out = await dailyStats(7)

    // The grouping must convert to the stats timezone via AT TIME ZONE so the
    // day boundaries match the dashboard "today" window regardless of the
    // Postgres session timezone.
    const sql = mocks.query.mock.calls[0][0] as string
    expect(sql).toContain("AT TIME ZONE $2, 'YYYY-MM-DD'")
    expect(mocks.query.mock.calls[0][1][1]).toBe(config.STATS_TIMEZONE)

    // Contiguous, zero-filled series of exactly `range` days.
    expect(out).toHaveLength(7)
    expect(out.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.day))).toBe(true)
    expect(out[0].day < out[out.length - 1].day).toBe(true)
  })
})
