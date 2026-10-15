import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface Candidate {
  id: string
  metadata: Record<string, unknown> | null
  effectiveWeight: number
  lastUsedAt: number | null
  status: string
  cooldownUntil: number | null
}

const mocks = vi.hoisted(() => ({ rows: [] as Candidate[] }))

vi.mock('../db/index', () => ({
  db: {
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    select: () => ({ from: () => ({ where: async () => mocks.rows }) }),
  },
}))
vi.mock('../db/settings', () => ({ getOpenAiSchedulingStrategy: async () => 'prefer_soonest_reset' }))
vi.mock('./session', () => ({ getStickyAccountId: async () => null }))

import { pickAccount } from './scheduler'

const NOW = 1_700_000_000_000

function metadata(resetAt: number | null): Record<string, unknown> {
  return { quota: { source: 'openai', updatedAt: NOW, windows: [
    { key: 'hourly', label: '5小时', usedPercent: 50, resetAt, exceeded: false },
  ] } }
}

function candidate(id: string, overrides: Partial<Candidate> = {}): Candidate {
  return { id, metadata: null, effectiveWeight: 1, lastUsedAt: null,
    status: 'active', cooldownUntil: null, ...overrides }
}

beforeEach(() => {
  mocks.rows = []
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
})
afterEach(() => vi.restoreAllMocks())

describe('pickAccount with prefer_soonest_reset', () => {
  it.each([null, {}, metadata(null), metadata(NOW - 1)])(
    'falls back to account weight when both reset times are unknown (%j)', async accountMetadata => {
      mocks.rows = [
        candidate('low-weight', { metadata: accountMetadata, effectiveWeight: 1 }),
        candidate('high-weight', { metadata: accountMetadata, effectiveWeight: 10 }),
      ]
      expect((await pickAccount('openai'))?.id).toBe('high-weight')
    },
  )

  it('uses LRU for equal weights and different kinds of unknown reset times', async () => {
    mocks.rows = [
      candidate('recent', { lastUsedAt: NOW, metadata: metadata(NOW - 1) }),
      candidate('never-used'),
    ]
    expect((await pickAccount('openai'))?.id).toBe('never-used')
  })

  it('still prefers a future reset over an unknown reset and higher weight', async () => {
    mocks.rows = [
      candidate('unknown', { effectiveWeight: 100 }),
      candidate('later', { metadata: metadata(NOW + 10_000), effectiveWeight: 10 }),
      candidate('soonest', { metadata: metadata(NOW + 1_000) }),
    ]
    expect((await pickAccount('openai'))?.id).toBe('soonest')
  })
})
