import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const upstream = vi.hoisted(() => ({ fetchWithConnectTimeout: vi.fn() }))
vi.mock('../../http/upstream', () => upstream)

import { fetchDeepSeekBalance, parseDeepSeekBalanceResponse } from './balance'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** The documented shape of `GET /user/balance`, with string amounts. */
function platformBalance(overrides: Record<string, unknown> = {}) {
  return {
    is_available: true,
    balance_infos: [
      {
        currency: 'CNY',
        total_balance: '110.00',
        granted_balance: '10.00',
        topped_up_balance: '100.00',
      },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parseDeepSeekBalanceResponse', () => {
  it('parses the documented string amounts and keeps the granted credit', () => {
    expect(parseDeepSeekBalanceResponse(platformBalance())).toEqual({
      endpoint: '/user/balance',
      mode: 'wallet',
      planName: 'DeepSeek 钱包余额',
      currency: 'CNY',
      totalBalance: 110,
      granted: 10,
      remaining: 110,
      available: true,
    })
  })

  it('keeps a zero balance instead of treating it as missing', () => {
    expect(parseDeepSeekBalanceResponse(platformBalance({
      is_available: false,
      balance_infos: [
        { currency: 'USD', total_balance: '0.00', granted_balance: '0.00', topped_up_balance: '0.00' },
      ],
    }))).toMatchObject({
      currency: 'USD',
      totalBalance: 0,
      remaining: 0,
      granted: 0,
      available: false,
      mode: 'exhausted',
    })
  })

  it('accepts numeric amounts and defaults the currency when it is missing', () => {
    const parsed = parseDeepSeekBalanceResponse({
      is_available: true,
      balance_infos: [{ total_balance: 12.5, granted_balance: 2.5 }],
    })

    expect(parsed.totalBalance).toBe(12.5)
    expect(parsed.remaining).toBe(12.5)
    expect(parsed.currency).toBeUndefined()
  })

  it('rejects a successful response in an unknown shape', () => {
    expect(() => parseDeepSeekBalanceResponse({ error: 'nope' })).toThrow('DeepSeek 余额返回格式无效')
    expect(() => parseDeepSeekBalanceResponse(null)).toThrow('DeepSeek 余额返回格式无效')
    expect(() => parseDeepSeekBalanceResponse({ is_available: true, balance_infos: [] }))
      .toThrow('缺少 balance_infos')
    expect(() => parseDeepSeekBalanceResponse({ is_available: true, balance_infos: [{ currency: 'USD' }] }))
      .toThrow('缺少金额字段')
  })
})

describe('fetchDeepSeekBalance', () => {
  it('queries the official platform endpoint with bearer credentials', async () => {
    upstream.fetchWithConnectTimeout.mockResolvedValue(jsonResponse(platformBalance()))

    const balance = await fetchDeepSeekBalance('sk-deepseek')

    expect(upstream.fetchWithConnectTimeout.mock.calls[0]?.[0]).toBe('https://api.deepseek.com/user/balance')
    expect(upstream.fetchWithConnectTimeout.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      redirect: 'error',
      headers: { authorization: 'Bearer sk-deepseek' },
    })
    expect(balance).toMatchObject({ remaining: 110, granted: 10, currency: 'CNY' })
  })

  it('surfaces an auth failure with a key hint instead of the raw body', async () => {
    upstream.fetchWithConnectTimeout.mockResolvedValue(
      new Response('{"error":{"message":"Authentication Fails"}}', { status: 401 }),
    )

    await expect(fetchDeepSeekBalance('sk-bad')).rejects.toThrow(
      'DeepSeek 余额查询失败：/user/balance 返回 HTTP 401，请检查 API Key 是否有效',
    )
  })

  it('reports a non-JSON success response', async () => {
    upstream.fetchWithConnectTimeout.mockResolvedValue(new Response('<html></html>', { status: 200 }))

    await expect(fetchDeepSeekBalance('sk-deepseek')).rejects.toThrow('返回了非 JSON 响应')
  })

  it('reports a sanitized network failure', async () => {
    const networkError = Object.assign(new Error('fetch failed'), {
      cause: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:443' },
    })
    upstream.fetchWithConnectTimeout.mockRejectedValue(networkError)

    await expect(fetchDeepSeekBalance('sk-deepseek')).rejects.toThrow(
      'DeepSeek 余额查询失败：/user/balance 网络请求失败（ECONNREFUSED）',
    )
  })

  it('reports a timeout without leaking the URL query', async () => {
    upstream.fetchWithConnectTimeout.mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    )

    await expect(fetchDeepSeekBalance('sk-deepseek')).rejects.toThrow(
      'DeepSeek 余额查询失败：/user/balance 请求超时（15s）',
    )
  })
})
