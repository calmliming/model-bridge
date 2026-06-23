import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchOpenAIQuota,
  openAIAccountIdFromMetadata,
  OpenAIQuotaError,
  resetOpenAIQuota,
  snapshotFromUsage,
} from './quota'
import type { OpenAIUsageResponse } from './types'

const NOW = 1_700_000_000_000

describe('snapshotFromUsage', () => {
  it('maps primary/secondary windows to hourly/weekly by window length', () => {
    const usage: OpenAIUsageResponse = {
      rate_limit: {
        primary_window: { used_percent: 40, limit_window_seconds: 18_000, reset_at: 1_700_000_900 },
        secondary_window: { used_percent: 12, limit_window_seconds: 604_800, reset_at: 1_700_600_000 },
      },
      rate_limit_reset_credits: { available_count: 3 },
    }
    const snapshot = snapshotFromUsage(usage, NOW)
    expect(snapshot.source).toBe('openai')
    expect(snapshot.resetCredits).toBe(3)
    expect(snapshot.windows).toEqual([
      { key: 'hourly', label: '5小时', usedPercent: 40, resetAt: 1_700_000_900_000, exceeded: false },
      { key: 'weekly', label: '7天', usedPercent: 12, resetAt: 1_700_600_000_000, exceeded: false },
    ])
  })

  it('swaps windows when the shorter one arrives as secondary', () => {
    const usage: OpenAIUsageResponse = {
      rate_limit: {
        primary_window: { used_percent: 10, limit_window_seconds: 604_800 },
        secondary_window: { used_percent: 90, limit_window_seconds: 18_000 },
      },
    }
    const snapshot = snapshotFromUsage(usage, NOW)
    expect(snapshot.windows.map((w) => [w.key, w.usedPercent])).toEqual([
      ['hourly', 90],
      ['weekly', 10],
    ])
  })

  it('derives resetAt from reset_after_seconds when reset_at is absent', () => {
    const usage: OpenAIUsageResponse = {
      rate_limit: { primary_window: { used_percent: 50, reset_after_seconds: 600 } },
    }
    const [hourly] = snapshotFromUsage(usage, NOW).windows
    expect(hourly.resetAt).toBe(NOW + 600_000)
  })

  it('marks a window exceeded at 100% and clamps used percent', () => {
    const usage: OpenAIUsageResponse = {
      rate_limit: { primary_window: { used_percent: 130, limit_window_seconds: 18_000 } },
    }
    const [hourly] = snapshotFromUsage(usage, NOW).windows
    expect(hourly.usedPercent).toBe(100)
    expect(hourly.exceeded).toBe(true)
  })

  it('returns no windows and null credits for an empty rate limit', () => {
    const snapshot = snapshotFromUsage({}, NOW)
    expect(snapshot.windows).toEqual([])
    expect(snapshot.resetCredits).toBeNull()
  })
})

describe('openAIAccountIdFromMetadata', () => {
  it('reads chatgptAccountId, falling back to organizationId', () => {
    expect(openAIAccountIdFromMetadata({ openai: { chatgptAccountId: 'acct-1' } })).toBe('acct-1')
    expect(openAIAccountIdFromMetadata({ openai: { organizationId: 'org-1' } })).toBe('org-1')
  })

  it('returns null when no identity is stored', () => {
    expect(openAIAccountIdFromMetadata(null)).toBeNull()
    expect(openAIAccountIdFromMetadata({})).toBeNull()
    expect(openAIAccountIdFromMetadata({ openai: {} })).toBeNull()
  })
})

describe('fetchOpenAIQuota', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends the ChatGPT identity headers and maps the response', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(
        JSON.stringify({
          rate_limit: { primary_window: { used_percent: 30, limit_window_seconds: 18_000 } },
          rate_limit_reset_credits: { available_count: 2 },
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const snapshot = await fetchOpenAIQuota('tok-secret', 'acct-123')
    expect(snapshot.resetCredits).toBe(2)
    expect(snapshot.windows[0]).toMatchObject({ key: 'hourly', usedPercent: 30 })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://chatgpt.com/backend-api/wham/usage')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['chatgpt-account-id']).toBe('acct-123')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok-secret')
  })

  it('raises a quota error carrying the upstream status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 403 })))
    await expect(fetchOpenAIQuota('tok', 'acct')).rejects.toMatchObject({
      name: 'OpenAIQuotaError',
      statusCode: 403,
    })
  })
})

describe('resetOpenAIQuota', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('posts a redeem_request_id and returns windows reset', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ windows_reset: 2 }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await resetOpenAIQuota('tok', 'acct-9')
    expect(result.windowsReset).toBe(2)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body.redeem_request_id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('raises an error when no reset credit is available', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no credit', { status: 429 })))
    await expect(resetOpenAIQuota('tok', 'acct')).rejects.toBeInstanceOf(OpenAIQuotaError)
  })
})
