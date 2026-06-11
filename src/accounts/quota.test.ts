import { describe, expect, it } from 'vitest'

import {
  accountAutopausePercent,
  accountQuotaFromMetadata,
  extractAccountQuota,
  extractClaudeOAuthUsageQuota,
  quotaCooldownUntil,
  quotaPauseUntil,
  resolveAutopausePercent,
} from './quota'

describe('extractAccountQuota', () => {
  it('extracts Claude 5-hour and 7-day quota windows from response headers', () => {
    const quota = extractAccountQuota(
      'claude',
      new Headers({
        'anthropic-ratelimit-unified-5h-utilization': '0.42',
        'anthropic-ratelimit-unified-5h-reset': '1800000000',
        'anthropic-ratelimit-unified-7d-utilization': '0.9',
        'anthropic-ratelimit-unified-7d-reset': '1800100000',
      }),
      1700000000000,
    )

    expect(quota?.windows).toEqual([
      {
        key: 'hourly',
        label: '5小时',
        usedPercent: 42,
        resetAt: 1800000000000,
        exceeded: false,
      },
      {
        key: 'weekly',
        label: '7天',
        usedPercent: 90,
        resetAt: 1800100000000,
        exceeded: false,
      },
    ])
  })

  it('extracts Claude OAuth usage from the usage endpoint response', () => {
    const quota = extractClaudeOAuthUsageQuota(
      {
        five_hour: { utilization: 12.5, resets_at: '2026-05-25T12:00:00Z' },
        seven_day: { utilization: 45, resets_at: '2026-05-26T12:00:00Z' },
        seven_day_sonnet: { utilization: 67, resets_at: '2026-05-27T12:00:00Z' },
      },
      1700000000000,
    )

    expect(quota?.windows.map((window) => [window.key, window.label, window.usedPercent, window.resetAt])).toEqual([
      ['hourly', '5小时', 12.5, 1779710400000],
      ['weekly', '7天', 45, 1779796800000],
      ['weekly_sonnet', '7天 Sonnet', 67, 1779883200000],
    ])
  })

  it('extracts Codex 5-hour and 7-day quota windows from response headers', () => {
    const quota = extractAccountQuota(
      'openai',
      new Headers({
        'x-codex-primary-used-percent': '88',
        'x-codex-primary-reset-after-seconds': '604800',
        'x-codex-primary-window-minutes': '10080',
        'x-codex-secondary-used-percent': '42',
        'x-codex-secondary-reset-after-seconds': '18000',
        'x-codex-secondary-window-minutes': '300',
      }),
      1700000000000,
    )

    expect(quota?.windows.map((window) => [window.label, window.usedPercent, window.resetAt])).toEqual([
      ['5小时', 42, 1700018000000],
      ['7天', 88, 1700604800000],
    ])
  })

  it('uses the Codex legacy primary=7d secondary=5h mapping when window size is absent', () => {
    const quota = extractAccountQuota(
      'openai',
      new Headers({
        'x-codex-primary-used-percent': '12',
        'x-codex-primary-reset-after-seconds': '604800',
        'x-codex-secondary-used-percent': '64',
        'x-codex-secondary-reset-after-seconds': '3600',
      }),
      1700000000000,
    )

    expect(quota?.windows.map((window) => [window.label, window.usedPercent, window.resetAt])).toEqual([
      ['5小时', 64, 1700003600000],
      ['7天', 12, 1700604800000],
    ])
  })

  it('treats Codex decimal used-percent headers as ratios', () => {
    const quota = extractAccountQuota(
      'openai',
      new Headers({
        'x-codex-primary-used-percent': '0.125',
        'x-codex-primary-reset-after-seconds': '604800',
        'x-codex-primary-window-minutes': '10080',
        'x-codex-secondary-used-percent': '1.0',
        'x-codex-secondary-reset-after-seconds': '18000',
        'x-codex-secondary-window-minutes': '300',
      }),
      1700000000000,
    )

    expect(quota?.windows.map((window) => [window.label, window.usedPercent, window.exceeded])).toEqual([
      ['5小时', 100, true],
      ['7天', 12.5, false],
    ])
  })
})

describe('accountQuotaFromMetadata', () => {
  it('returns a sanitized quota snapshot without exposing unrelated metadata', () => {
    const quota = accountQuotaFromMetadata({
      project: 'secret-project',
      quota: {
        source: 'claude',
        updatedAt: 1700000000000,
        windows: [
          {
            key: 'hourly',
            label: '5小时',
            usedPercent: 50,
            resetAt: null,
            exceeded: false,
          },
        ],
      },
    })

    expect(quota).toEqual({
      source: 'claude',
      updatedAt: 1700000000000,
      windows: [
        {
          key: 'hourly',
          label: '5小时',
          usedPercent: 50,
          resetAt: null,
          exceeded: false,
        },
      ],
    })
  })
})

describe('quotaCooldownUntil', () => {
  it('uses the nearest future reset time from exceeded quota windows', () => {
    expect(
      quotaCooldownUntil(
        {
          source: 'claude',
          updatedAt: 1700000000000,
          windows: [
            { key: 'hourly', label: '5小时', usedPercent: 100, resetAt: 1700007200000, exceeded: true },
            { key: 'weekly', label: '7天', usedPercent: 100, resetAt: 1700604800000, exceeded: true },
            { key: 'weekly_sonnet', label: '7天 Sonnet', usedPercent: 80, resetAt: 1700100000000, exceeded: false },
          ],
        },
        1700000000000,
      ),
    ).toBe(1700007200000)
  })

  it('ignores exceeded quota windows without a future reset time', () => {
    expect(
      quotaCooldownUntil(
        {
          source: 'openai',
          updatedAt: 1700000000000,
          windows: [
            { key: 'hourly', label: '5小时', usedPercent: 100, resetAt: null, exceeded: true },
            { key: 'weekly', label: '7天', usedPercent: 100, resetAt: 1699999999999, exceeded: true },
          ],
        },
        1700000000000,
      ),
    ).toBeNull()
  })
})

describe('quotaPauseUntil', () => {
  const now = 1700000000000
  const snapshot = {
    source: 'claude' as const,
    updatedAt: now,
    windows: [
      { key: 'hourly' as const, label: '5小时', usedPercent: 85, resetAt: now + 3_600_000, exceeded: false },
      { key: 'weekly' as const, label: '7天', usedPercent: 40, resetAt: now + 86_400_000, exceeded: false },
    ],
  }

  it('does not pause below the threshold (100 = legacy behavior)', () => {
    expect(quotaPauseUntil(snapshot, 100, now)).toBeNull()
  })

  it('pauses until the breaching window reset once usage reaches the threshold', () => {
    expect(quotaPauseUntil(snapshot, 80, now)).toBe(now + 3_600_000)
  })

  it('picks the nearest future reset when several windows cross the threshold', () => {
    expect(quotaPauseUntil(snapshot, 30, now)).toBe(now + 3_600_000)
  })

  it('threshold 0 disables the early pause but still respects exceeded windows', () => {
    expect(quotaPauseUntil(snapshot, 0, now)).toBeNull()
    expect(
      quotaPauseUntil(
        {
          source: 'claude',
          updatedAt: now,
          windows: [{ key: 'hourly', label: '5小时', usedPercent: 100, resetAt: now + 1_000, exceeded: true }],
        },
        0,
        now,
      ),
    ).toBe(now + 1_000)
  })

  it('ignores windows whose reset time has already passed', () => {
    expect(
      quotaPauseUntil(
        {
          source: 'claude',
          updatedAt: now,
          windows: [{ key: 'hourly', label: '5小时', usedPercent: 95, resetAt: now - 1_000, exceeded: false }],
        },
        80,
        now,
      ),
    ).toBeNull()
  })

  it('returns null for a missing snapshot', () => {
    expect(quotaPauseUntil(null, 50, now)).toBeNull()
  })
})

describe('accountAutopausePercent / resolveAutopausePercent', () => {
  it('reads a per-account override from metadata', () => {
    expect(accountAutopausePercent({ autopausePercent: 75 })).toBe(75)
    expect(accountAutopausePercent({ autopausePercent: 0 })).toBe(0)
  })

  it('clamps and truncates the override', () => {
    expect(accountAutopausePercent({ autopausePercent: 250 })).toBe(100)
    expect(accountAutopausePercent({ autopausePercent: -5 })).toBe(0)
    expect(accountAutopausePercent({ autopausePercent: 42.9 })).toBe(42)
  })

  it('returns null when no override is set', () => {
    expect(accountAutopausePercent(null)).toBeNull()
    expect(accountAutopausePercent({})).toBeNull()
    expect(accountAutopausePercent({ autopausePercent: 'oops' })).toBeNull()
  })

  it('resolves to the override when present, else the global default', () => {
    expect(resolveAutopausePercent({ autopausePercent: 60 }, 90)).toBe(60)
    expect(resolveAutopausePercent({ autopausePercent: 0 }, 90)).toBe(0)
    expect(resolveAutopausePercent({}, 90)).toBe(90)
    expect(resolveAutopausePercent(null, 100)).toBe(100)
  })
})
