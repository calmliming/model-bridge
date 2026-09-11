import { afterEach, describe, expect, it, vi } from 'vitest'
import { minimaxBaseUrl, relayMiniMax, testMiniMax } from './relay'
import { fetchMiniMaxQuota, parseMiniMaxQuota } from './quota'
import { createStreamParser, createMessagesStreamParser, parseJsonUsage } from './usage'
import { accountQuotaFromMetadata, quotaPauseUntil } from '../../accounts/quota'

afterEach(() => vi.unstubAllGlobals())

describe('MiniMax transport', () => {
  it('rejects query-bearing or fragment-bearing SDK base URLs', () => {
    expect(() => minimaxBaseUrl('https://api.minimax.io/v1?foo=bar')).toThrow()
    expect(() => minimaxBaseUrl('https://api.minimax.io/#v1')).toThrow()
  })
  it.each(['', '/v1/', '/anthropic/', '/anthropic/v1/'])('normalizes the SDK base suffix %s', suffix => {
    expect(minimaxBaseUrl(`https://api.minimax.io${suffix}`)).toBe('https://api.minimax.io')
  })

  it.each([
    ['messages', '/anthropic/v1/messages'], ['chat', '/v1/chat/completions'], ['responses', '/v1/responses'],
  ] as const)('forwards native %s bodies with Bearer auth', async (protocol, path) => {
    const fetch = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetch)
    const body = {
      model: 'MiniMax-M3', stream: false, reasoning: { effort: 'none' },
      input: [{ role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,AA==' }] }],
      tools: [{ type: 'function', name: 'lookup', parameters: { type: 'object' } }],
      prompt_cache_key: 'conversation', service_tier: 'priority',
    }
    await relayMiniMax('secret', body, protocol, 'https://api.minimax.io/v1/')
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://api.minimax.io${path}`)
    expect(init.headers).toMatchObject({ authorization: 'Bearer secret' })
    expect(JSON.parse(init.body as string)).toEqual(body)
  })

  it('requests chat usage without mutating the caller body', async () => {
    const fetch = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetch)
    const body = { model: 'minimax-m2.7', stream: true, stream_options: { custom: true } }
    await relayMiniMax('key', body, 'chat')
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'MiniMax-M2.7', stream_options: { custom: true, include_usage: true } })
    expect(body.stream_options).toEqual({ custom: true })
  })

  it('rejects malformed model-list success responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"unauthorized"}')))
    await expect(testMiniMax('key')).rejects.toThrow('格式无效')
  })
})

const now = 1_800_000_000_000
const quota = (patch = {}) => ({ base_resp: { status_code: 0 }, model_remains: [
  { model_name: 'video', current_interval_remaining_percent: 0 },
  { model_name: 'general', current_interval_remaining_percent: 10, end_time: (now + 10000) / 1000,
    current_weekly_status: 1, current_weekly_remaining_percent: 5, weekly_end_time: now + 20000, ...patch },
] })

describe('MiniMax quota and usage', () => {
  it('keeps reported Messages tier and disjoint Anthropic cache usage', () => {
    const parser = createMessagesStreamParser()
    parser.feed({ type: 'message_start', message: { service_tier: 'priority', usage: { input_tokens: 10, cache_read_input_tokens: 20 } } })
    parser.feed({ type: 'message_delta', usage: { output_tokens: 5 } })
    expect(parser.result()).toMatchObject({ serviceTier: 'priority', inputTokens: 10, cacheReadTokens: 20, outputTokens: 5 })
  })
  it('uses general remaining percentages and waits until every breached window resets', () => {
    const result = parseMiniMaxQuota(quota(), now)
    expect(result.windows.map(x => [x.key, x.usedPercent, x.resetAt])).toEqual([
      ['hourly', 90, now + 10000], ['weekly', 95, now + 20000],
    ])
    expect(quotaPauseUntil(result, 80, now)).toBe(now + 20000)
    expect(accountQuotaFromMetadata({ quota: result })).toEqual(result)
  })

  it('ignores disabled weekly windows and rejects unknown/malformed quotas', () => {
    expect(parseMiniMaxQuota(quota({ current_weekly_status: 0 }), now).windows).toHaveLength(1)
    expect(() => parseMiniMaxQuota({ model_remains: [] })).toThrow()
    expect(() => parseMiniMaxQuota(quota({ current_interval_remaining_percent: null, current_weekly_status: 0 }))).toThrow()
    expect(() => parseMiniMaxQuota({ ...quota(), base_resp: { status_code: 1004 } })).toThrow('1004')
  })

  it('queries the matching region using Bearer auth and never treats failures as empty quota', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(quota())))
    vi.stubGlobal('fetch', fetch)
    await fetchMiniMaxQuota('plan-key', 'https://api.minimax.io/anthropic')
    expect(fetch).toHaveBeenCalledWith('https://api.minimax.io/v1/api/openplatform/coding_plan/remains',
      expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer plan-key' }) }))
    fetch.mockImplementation(async () => new Response('{}', { status: 401 }))
    await expect(fetchMiniMaxQuota('bad-key')).rejects.toThrow('401')
  })

  it('bills vision input as ordinary model tokens and preserves failed response usage', () => {
    const response = { service_tier: 'priority', usage: {
      input_tokens: 100, input_tokens_details: { cached_tokens: 20, image_tokens: 30 },
      output_tokens: 15, output_tokens_details: { reasoning_tokens: 5 },
    } }
    expect(parseJsonUsage(response)).toMatchObject({ inputTokens: 80, cacheReadTokens: 20, outputTokens: 15, reasoningTokens: 5, serviceTier: 'priority' })
    expect(parseJsonUsage(response).imageInputTokens).toBeUndefined()
    const parser = createStreamParser()
    parser.feed({ type: 'response.failed', response })
    expect(parser.result()).toEqual(parseJsonUsage(response))
  })
})
