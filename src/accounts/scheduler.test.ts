import { describe, expect, it } from 'vitest'
import {
  canonicalModelCooldownKey,
  modelCooldownUntil,
  soonestReset,
  unavailableAccountMessage,
  type AccountAvailability,
} from './scheduler'

const NOW = 1_700_000_000_000

/** Availability summary with sane defaults, overridable per case. */
function availability(overrides: Partial<AccountAvailability> = {}): AccountAvailability {
  return {
    total: 1,
    active: 0,
    cooling: 0,
    disabled: 0,
    coolingSticky: 0,
    earliestCooldownUntil: null,
    ...overrides,
  }
}

describe('unavailableAccountMessage', () => {
  it('says the pool is empty only when no account exists at all', () => {
    expect(unavailableAccountMessage('生成服务', availability({ total: 0 }), 0, NOW))
      .toBe('no 生成服务 account configured')
  })

  it('reports a cooling account with a retry hint instead of missing configuration', () => {
    // The bug this guards: one upstream 5xx puts the only account into cooldown,
    // and the next request is told "no account configured", which sends operators
    // to check settings that are already correct.
    const summary = availability({ cooling: 1, coolingSticky: 1, earliestCooldownUntil: NOW + 42_000 })
    const message = unavailableAccountMessage('生成服务', summary, 1, NOW)
    expect(message).toBe('生成服务账号正在冷却中（共 1 个，最快约 42 秒后恢复），请稍后重试')
    expect(message).not.toContain('account configured')
  })

  it('rounds a cooldown that is about to expire to at least one second', () => {
    const summary = availability({ cooling: 2, earliestCooldownUntil: NOW + 200 })
    expect(unavailableAccountMessage('生成服务', summary, 0, NOW)).toContain('最快约 1 秒后恢复')
  })

  it('lists disabled accounts when the whole pool is disabled', () => {
    expect(unavailableAccountMessage('生成服务', availability({ total: 2, disabled: 2 }), 0, NOW))
      .toBe('all 生成服务 accounts are disabled')
  })

  it('keeps the all-tried wording when accounts were reachable but every attempt failed', () => {
    expect(unavailableAccountMessage('生成服务', availability({ total: 1 }), 1, NOW))
      .toBe('all 生成服务 accounts are unavailable')
  })

  it('reports remaining untried accounts without claiming none exist', () => {
    expect(unavailableAccountMessage('生成服务', availability({ total: 3, disabled: 1, active: 2 }), 0, NOW))
      .toBe('no available 生成服务 account')
  })
})

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

  it('shares one image-capability cooldown across GPT Image models', () => {
    const metadata = { modelCooldowns: { 'openai:image_generation': NOW + 60_000 } }
    expect(canonicalModelCooldownKey('gpt-image-2')).toBe('openai:image_generation')
    expect(canonicalModelCooldownKey('gpt-image-1.5')).toBe('openai:image_generation')
    expect(modelCooldownUntil(metadata, 'gpt-image-2')).toBe(NOW + 60_000)
    expect(modelCooldownUntil(metadata, 'gpt-5.6-sol')).toBeNull()
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
