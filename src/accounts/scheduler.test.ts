import { describe, expect, it } from 'vitest'
import { canonicalModelCooldownKey, modelCooldownUntil, soonestReset } from './scheduler'

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

describe('modelCooldownUntil (model-scoped cooldowns)', () => {
  it('reads the stored cooldown for the requested model only', () => {
    const metadata = { modelCooldowns: { 'gpt-5.6-luna': NOW + 60_000 } }
    expect(modelCooldownUntil(metadata, 'gpt-5.6-luna')).toBe(NOW + 60_000)
    expect(modelCooldownUntil(metadata, 'gpt-5.6-sol')).toBeNull()
  })

  it('returns null for missing/invalid metadata shapes', () => {
    expect(modelCooldownUntil(null, 'gpt-5.6-luna')).toBeNull()
    expect(modelCooldownUntil({}, 'gpt-5.6-luna')).toBeNull()
    expect(modelCooldownUntil({ modelCooldowns: 'bad' }, 'gpt-5.6-luna')).toBeNull()
    expect(modelCooldownUntil({ modelCooldowns: { 'gpt-5.6-luna': 'soon' } }, 'gpt-5.6-luna')).toBeNull()
    expect(modelCooldownUntil({ modelCooldowns: { 'gpt-5.6-luna': NOW } }, '')).toBeNull()
  })

  it('shares a cooldown across Fable model aliases', () => {
    const metadata = { modelCooldowns: { 'claude-fable-5': NOW + 60_000 } }
    expect(canonicalModelCooldownKey('claude-fable-5-1')).toBe('claude-fable-5')
    expect(canonicalModelCooldownKey('claude-fable-5-20260801')).toBe('claude-fable-5')
    expect(canonicalModelCooldownKey('claude-mythos-5')).toBe('claude-fable-5')
    expect(modelCooldownUntil(metadata, 'claude-fable-5-20260801')).toBe(NOW + 60_000)
    expect(modelCooldownUntil(metadata, 'claude-sonnet-5')).toBeNull()
  })

  it('shares a cooldown across Codex Spark model suffixes', () => {
    const metadata = { modelCooldowns: { 'gpt-5.3-codex-spark': NOW + 60_000 } }
    expect(canonicalModelCooldownKey('gpt-5.3-codex-spark')).toBe('gpt-5.3-codex-spark')
    expect(modelCooldownUntil(metadata, 'gpt-5.3-codex-spark-high')).toBe(NOW + 60_000)
  })

  it('filters accounts the way pickAccount does', () => {
    const accounts = [
      { id: 'cooling', metadata: { modelCooldowns: { m1: NOW + 5_000 } } },
      { id: 'expired', metadata: { modelCooldowns: { m1: NOW - 5_000 } } },
      { id: 'other-model', metadata: { modelCooldowns: { m2: NOW + 5_000 } } },
      { id: 'clean', metadata: {} },
    ]
    const available = accounts.filter(
      (a) => !((modelCooldownUntil(a.metadata, 'm1') ?? 0) > NOW),
    )
    expect(available.map((a) => a.id)).toEqual(['expired', 'other-model', 'clean'])
  })
})
