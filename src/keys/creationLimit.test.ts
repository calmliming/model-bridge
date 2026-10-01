import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ row: { active: 0, recent: 0 } as Record<string, unknown>, select: vi.fn() }))

vi.mock('../db/index', () => ({
  db: {
    select: (...args: unknown[]) => {
      mocks.select(...args)
      return { from: () => ({ where: async () => [mocks.row] }) }
    },
  },
}))

import { apiKeyCreationLimitError } from './manager'

describe('apiKeyCreationLimitError', () => {
  const limits = { maxActive: 3, maxPerHour: 2 }
  beforeEach(() => {
    mocks.select.mockClear()
    mocks.row = { active: 0, recent: 0 }
  })

  it('allows creation under both limits', async () => {
    mocks.row = { active: '2', recent: '1' } // pg returns counts as strings
    expect(await apiKeyCreationLimitError('user-1', limits)).toBeNull()
  })

  it('rejects at the active key limit before the hourly limit', async () => {
    mocks.row = { active: 3, recent: 5 }
    expect(await apiKeyCreationLimitError('user-1', limits)).toContain('3 个')
  })

  it('rejects at the hourly creation limit', async () => {
    mocks.row = { active: 0, recent: 2 }
    expect(await apiKeyCreationLimitError('user-1', limits)).toContain('每小时最多 2 个')
  })

  it('treats 0 as unlimited and skips the query when both are disabled', async () => {
    mocks.row = { active: 999, recent: 999 }
    expect(await apiKeyCreationLimitError('user-1', { maxActive: 0, maxPerHour: 0 })).toBeNull()
    expect(mocks.select).not.toHaveBeenCalled()
    expect(await apiKeyCreationLimitError('user-1', { maxActive: 0, maxPerHour: 1000 })).toBeNull()
  })
})
