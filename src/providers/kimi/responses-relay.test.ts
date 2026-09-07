import { beforeEach, describe, expect, it, vi } from 'vitest'
const fetchUpstream = vi.hoisted(() => vi.fn())
vi.mock('../../http/upstream', () => ({ fetchWithConnectTimeout: fetchUpstream }))
import { relayNativeKimiResponses, supportsNativeKimiResponses } from './responses-relay'
import { createStreamParser } from './responses-usage'

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
  it('only chooses native Responses for the officially supported K3 model', () => {
    expect(supportsNativeKimiResponses('kimi-k3')).toBe(true)
    expect(supportsNativeKimiResponses('kimi-code/k3')).toBe(true)
    expect(supportsNativeKimiResponses('kimi-k2.7-code')).toBe(false)
  })
  it.each(['response.failed', 'response.incomplete'])('retains billable usage on %s', (type) => {
    const parser = createStreamParser()
    parser.feed({ type, response: { usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 25 } } } })
    expect(parser.result()).toMatchObject({ inputTokens: 75, cacheReadTokens: 25, outputTokens: 20 })
  })
})
