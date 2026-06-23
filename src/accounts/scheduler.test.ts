import { describe, expect, it } from 'vitest'
import { soonestReset } from './scheduler'

const NOW = 1_700_000_000_000

/** Builds account metadata carrying an OpenAI quota snapshot. */
function metaWithReset(...resetAts: Array<number | null>): Record<string, unknown> {
  return {
    quota: {
      source: 'openai',
      updatedAt: NOW,
      windows: resetAts.map((resetAt, i) => ({
        key: i === 0 ? 'hourly' : 'weekly',
        label: i === 0 ? '5小时' : '7天',
        usedPercent: 50,
        resetAt,
        exceeded: false,
      })),
    },
  }
}

describe('soonestReset (prefer_soonest_reset ordering)', () => {
  it('returns the nearest future window reset', () => {
    expect(soonestReset(metaWithReset(NOW + 3_600_000, NOW + 86_400_000), NOW)).toBe(NOW + 3_600_000)
  })

  it('ignores reset times that have already passed', () => {
    expect(soonestReset(metaWithReset(NOW - 1_000, NOW + 5_000), NOW)).toBe(NOW + 5_000)
  })

  it('returns Infinity when no quota or future reset is known', () => {
    expect(soonestReset(null, NOW)).toBe(Number.POSITIVE_INFINITY)
    expect(soonestReset({}, NOW)).toBe(Number.POSITIVE_INFINITY)
    expect(soonestReset(metaWithReset(null, null), NOW)).toBe(Number.POSITIVE_INFINITY)
    expect(soonestReset(metaWithReset(NOW - 10_000), NOW)).toBe(Number.POSITIVE_INFINITY)
  })

  it('orders accounts so the soonest-resetting one wins', () => {
    const accounts = [
      { id: 'late', metadata: metaWithReset(NOW + 50_000) },
      { id: 'soon', metadata: metaWithReset(NOW + 1_000) },
      { id: 'none', metadata: {} },
    ]
    accounts.sort((a, b) => soonestReset(a.metadata, NOW) - soonestReset(b.metadata, NOW))
    expect(accounts.map((a) => a.id)).toEqual(['soon', 'late', 'none'])
  })
})
