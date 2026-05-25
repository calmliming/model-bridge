import { describe, expect, it } from 'vitest'

import { accountQuotaFromMetadata, extractAccountQuota, extractClaudeOAuthUsageQuota } from './quota'

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
        'x-codex-primary-used-percent': '1',
        'x-codex-primary-reset-after-seconds': '604800',
        'x-codex-secondary-used-percent': '64',
        'x-codex-secondary-reset-after-seconds': '3600',
      }),
      1700000000000,
    )

    expect(quota?.windows.map((window) => [window.label, window.usedPercent, window.resetAt])).toEqual([
      ['5小时', 64, 1700003600000],
      ['7天', 1, 1700604800000],
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
