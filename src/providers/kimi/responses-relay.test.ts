import { beforeEach, describe, expect, it, vi } from 'vitest'
const fetchUpstream = vi.hoisted(() => vi.fn())
vi.mock('../../http/upstream', () => ({ fetchWithConnectTimeout: fetchUpstream }))
import { relayNativeKimiResponses, supportsNativeKimiResponses } from './responses-relay'
import { createStreamParser, parseJsonUsage } from './responses-usage'
import { estimateCost } from '../../usage/pricing'

beforeEach(() => fetchUpstream.mockReset())

describe('native Kimi Responses', () => {
  it('preserves native tools, images, reasoning, and cache identity', async () => {
    fetchUpstream.mockResolvedValue(new Response('{}'))
    const body = { model: 'k3', input: [{ role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,AA==' }] }],
      tools: [{ type: 'web_search' }, { type: 'custom', name: 'apply_patch' }, { type: 'namespace', name: 'tools', tools: [] }],
      reasoning: { effort: 'high' }, prompt_cache_key: 'session-1', max_output_tokens: 4096 }
    await relayNativeKimiResponses('secret', body)
    expect(fetchUpstream.mock.calls[0][0]).toBe('https://api.moonshot.cn/v1/responses')
    expect(JSON.parse(fetchUpstream.mock.calls[0][1].body)).toEqual({ ...body, model: 'kimi-k3', stream: false })
    expect(fetchUpstream.mock.calls[0][1].headers.accept).toBe('application/json')
  })
  it('drops relay-stamped reasoning from K2 turns before native K3', async () => {
    fetchUpstream.mockResolvedValue(new Response('{}'))
    const user = { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'next' }] }
    await relayNativeKimiResponses('secret', { model: 'k3', input: [
      { type: 'reasoning', id: 'rs_k2', summary: [], encrypted_content: 'mb1:dGhpbms=' }, user,
    ] })
    expect(JSON.parse(fetchUpstream.mock.calls[0][1].body).input).toEqual([user])
  })
  it('chooses native Responses for the K3 models and keeps the K2 adapter', () => {
    expect(supportsNativeKimiResponses('kimi-k3')).toBe(true)
    expect(supportsNativeKimiResponses('kimi-code/k3')).toBe(true)
    expect(supportsNativeKimiResponses('kimi-k3.1-pro')).toBe(true)
    expect(supportsNativeKimiResponses('kimi-k3.1-pro-highspeed')).toBe(true)
    expect(supportsNativeKimiResponses('kimi-k2.7-code')).toBe(false)
  })
  it('charges K3.1 Pro cache writes once at the model-specific rate', async () => {
    const model = 'kimi-k3.1-pro'
    fetchUpstream.mockResolvedValue(new Response('{}'))
    await relayNativeKimiResponses('secret', { model, input: 'hello', reasoning: { effort: 'high' } })
    expect(JSON.parse(fetchUpstream.mock.calls[0][1].body)).toMatchObject({ model, reasoning: { effort: 'high' } })
    const usage = parseJsonUsage({ usage: { input_tokens: 100_000, output_tokens: 1_000,
      input_tokens_details: { cached_tokens: 30_000, cache_write_tokens: 40_000 } } })
    expect(usage).toMatchObject({ inputTokens: 30_000, cacheReadTokens: 30_000, cacheCreateTokens: 40_000 })
    expect(estimateCost('kimi', model, usage)).toBe(0.14238)
    expect(estimateCost('kimi', 'kimi-k3.1-pro-highspeed', usage)).toBe(0.2793)
  })
  it.each(['response.failed', 'response.incomplete'])('retains billable usage on %s', (type) => {
    const parser = createStreamParser()
    parser.feed({ type, response: { usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 25 } } } })
    expect(parser.result()).toMatchObject({ inputTokens: 75, cacheReadTokens: 25, outputTokens: 20 })
  })
})
