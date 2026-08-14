import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchSub2ApiBalance,
  parseSub2ApiBalanceResponse,
  sub2ApiBalanceFromMetadata,
} from './balance'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const originalHostAllowlist = process.env.UPSTREAM_HOST_ALLOWLIST

beforeEach(() => {
  process.env.UPSTREAM_HOST_ALLOWLIST = 'upstream.example'
})

afterEach(() => {
  if (originalHostAllowlist === undefined) delete process.env.UPSTREAM_HOST_ALLOWLIST
  else process.env.UPSTREAM_HOST_ALLOWLIST = originalHostAllowlist
  vi.unstubAllGlobals()
})

describe('parseSub2ApiBalanceResponse', () => {
  it('parses the official unrestricted wallet response', () => {
    expect(parseSub2ApiBalanceResponse({
      mode: 'unrestricted',
      planName: '钱包余额',
      remaining: 12.34,
      balance: 12.34,
      unit: 'USD',
    }, '/v1/usage')).toMatchObject({
      endpoint: '/v1/usage',
      mode: 'unrestricted',
      planName: '钱包余额',
      remaining: 12.34,
      currency: 'USD',
    })
  })

  it('parses the official quota-limited response', () => {
    expect(parseSub2ApiBalanceResponse({
      mode: 'quota_limited',
      quota: { limit: 100, used: 40, remaining: 60, unit: 'USD' },
      remaining: 60,
    }, '/v1/usage')).toMatchObject({
      endpoint: '/v1/usage',
      mode: 'quota_limited',
      totalBalance: 100,
      used: 40,
      remaining: 60,
      currency: 'USD',
    })
  })

  it('keeps a zero balance instead of treating it as missing', () => {
    const parsed = parseSub2ApiBalanceResponse({
      mode: 'quota_limited',
      quota: { limit: 0, used: 0, remaining: 0, unit: 'USD' },
      remaining: 0,
    }, '/v1/usage')

    expect(parsed).toMatchObject({ totalBalance: 0, used: 0, remaining: 0 })
  })

  it('maps the tightest subscription window and its actual reset time', () => {
    const weeklyStart = Date.parse('2026-07-20T00:00:00.000Z')
    const parsed = parseSub2ApiBalanceResponse({
      mode: 'unrestricted',
      planName: 'Pro',
      remaining: 6,
      unit: 'USD',
      subscription: {
        daily_limit_usd: 20,
        daily_usage_usd: 5,
        weekly_limit_usd: 10,
        weekly_usage_usd: 4,
        weekly_window_start: '2026-07-20T00:00:00.000Z',
        monthly_limit_usd: null,
        monthly_usage_usd: 0,
        expires_at: '2026-08-31T00:00:00.000Z',
      },
    }, '/v1/usage')

    expect(parsed).toMatchObject({
      hasSubscription: true,
      totalBalance: 10,
      used: 4,
      remaining: 6,
      resetAt: weeklyStart + 7 * 24 * 60 * 60 * 1000,
      expiresAt: Date.parse('2026-08-31T00:00:00.000Z'),
    })
  })

  it('maps the official -1 subscription sentinel to unlimited', () => {
    expect(parseSub2ApiBalanceResponse({
      mode: 'unrestricted',
      planName: 'Unlimited',
      remaining: -1,
      subscription: {
        daily_limit_usd: 0,
        daily_usage_usd: 0,
        weekly_limit_usd: null,
        weekly_usage_usd: 0,
      },
    }, '/v1/usage')).toMatchObject({
      hasSubscription: true,
      unlimited: true,
    })
  })

  it('accepts an official rate-limit-only response without inventing money', () => {
    const parsed = parseSub2ApiBalanceResponse({
      mode: 'quota_limited',
      status: 'active',
      rate_limits: [{ window: '5h', limit: 10, used: 2, remaining: 8 }],
    }, '/v1/usage')

    expect(parsed).toMatchObject({ endpoint: '/v1/usage', mode: 'quota_limited' })
    expect(parsed?.remaining).toBeUndefined()
  })
})

describe('fetchSub2ApiBalance', () => {
  it('uses the official endpoint with both supported API key headers', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse({
      mode: 'unrestricted',
      remaining: 12.34,
      balance: 12.34,
      unit: 'USD',
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchSub2ApiBalance('secret-key', 'https://upstream.example/v1/')

    expect(result).toMatchObject({ endpoint: '/v1/usage', remaining: 12.34 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://upstream.example/v1/usage')
    expect(init.method).toBe('GET')
    expect(init.headers).toMatchObject({
      authorization: 'Bearer secret-key',
      'x-api-key': 'secret-key',
      accept: 'application/json',
    })
    expect(init.redirect).toBe('error')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('falls back after a 200 response with no recognizable fields', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'ok' }))
      .mockResolvedValueOnce(jsonResponse({ data: { balance: '8.5', currency: 'USD' } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchSub2ApiBalance('secret-key', 'https://upstream.example')

    expect(result).toMatchObject({ endpoint: '/api/usage', remaining: 8.5, currency: 'USD' })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://upstream.example/v1/usage',
      'https://upstream.example/api/usage',
    ])
  })
})

describe('sub2ApiBalanceFromMetadata', () => {
  it('keeps only validated snapshot fields and preserves zero', () => {
    expect(sub2ApiBalanceFromMetadata({
      sub2apiBalance: {
        updatedAt: '1700000000123',
        totalBalance: '100',
        used: '40',
        remaining: 0,
        resetAt: '1700001000000',
        expiresAt: '1700002000000',
        hasSubscription: true,
        planName: 'Pro',
        currency: 'USD',
        mode: 'quota_limited',
        endpoint: '/v1/usage',
        ignored: 'secret',
      },
    })).toEqual({
      updatedAt: 1_700_000_000_123,
      totalBalance: 100,
      used: 40,
      remaining: 0,
      resetAt: 1_700_001_000_000,
      expiresAt: 1_700_002_000_000,
      hasSubscription: true,
      planName: 'Pro',
      currency: 'USD',
      mode: 'quota_limited',
      endpoint: '/v1/usage',
    })
  })

  it('accepts a persisted official mode without a monetary amount', () => {
    expect(sub2ApiBalanceFromMetadata({
      sub2apiBalance: { updatedAt: 1_700_000_000_000, mode: 'quota_limited' },
    })).toEqual({ updatedAt: 1_700_000_000_000, mode: 'quota_limited' })
  })

  it.each([
    {},
    { sub2apiBalance: { updatedAt: 0, remaining: 1 } },
    { sub2apiBalance: { updatedAt: Number.POSITIVE_INFINITY, remaining: 1 } },
    { sub2apiBalance: { updatedAt: 1_700_000_000_000, mode: 'unknown' } },
  ])('rejects invalid metadata snapshots', (metadata) => {
    expect(sub2ApiBalanceFromMetadata(metadata)).toBeNull()
  })
})
