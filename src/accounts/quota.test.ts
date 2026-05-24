import { describe, expect, it } from 'vitest'

import { accountQuotaFromMetadata, extractAccountQuota } from './quota'

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

  it('extracts Codex primary and secondary quota windows from response headers', () => {
    const quota = extractAccountQuota(
      'openai',
      new Headers({
        'x-codex-primary-used-percent': '31',
        'x-codex-primary-reset-after-seconds': '3600',
        'x-codex-secondary-used-percent': '64',
        'x-codex-secondary-reset-after-seconds': '604800',
      }),
      1700000000000,
    )

    expect(quota?.windows.map((window) => [window.label, window.usedPercent, window.resetAt])).toEqual([
      ['主额度', 31, 1700003600000],
      ['次额度', 64, 1700604800000],
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
