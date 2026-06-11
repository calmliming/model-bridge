import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}))

vi.mock('../db/index', () => ({
  pool: { query: mocks.query },
}))

vi.mock('./pricing', () => ({
  resolvePrice: vi.fn(() => null),
}))

import { dashboardRecentLogs } from './stats'

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
})
