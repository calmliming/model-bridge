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

import { parseOpenAIImagesRequest, type OpenAIImagesEndpoint } from '../openai/images'
import {
  buildMiniMaxImageRequest,
  canonicalMiniMaxImageModel,
  createMiniMaxImagesStreamParser,
  hasMiniMaxImageBillableWork,
  isMiniMaxImageModel,
  parseMiniMaxImageUsage,
  relayMiniMaxImages,
} from './images'
import { mapMiniMaxModel as mapModel } from './relay'

function parseMiniMaxReq(body: unknown, endpoint: OpenAIImagesEndpoint = 'generations') {
  return parseOpenAIImagesRequest(body, 'application/json', endpoint, {
    defaultModel: 'MiniMax-H3-Image',
    deferModelValidation: true,
  })
}

describe('MiniMax H3-Image', () => {
  it('recognizes, preserves, and canonicalizes H3-Image model names', () => {
    expect(isMiniMaxImageModel('MiniMax-H3-Image')).toBe(true)
    expect(isMiniMaxImageModel('minimax-h3-image-highspeed')).toBe(true)
    expect(isMiniMaxImageModel('MiniMax-M2.7')).toBe(false)
    expect(canonicalMiniMaxImageModel('minimax-h3-image')).toBe('MiniMax-H3-Image')
    expect(canonicalMiniMaxImageModel('minimax-h3-image-highspeed')).toBe('MiniMax-H3-Image-Highspeed')
    expect(mapModel('minimax-h3-image')).toBe('MiniMax-H3-Image')
    expect(mapModel('minimax-h3-image-highspeed')).toBe('MiniMax-H3-Image-Highspeed')
  })

  it('builds valid generation and edit payloads and validates MiniMax constraints', () => {
    const gen = parseMiniMaxReq({
      model: 'minimax-h3-image',
      prompt: 'a neon skyline at dusk',
      size: '1920x1080',
      n: 2,
      output_format: 'webp',
      disable_prompt_enhanced: true,
    })
    expect(buildMiniMaxImageRequest(gen)).toEqual({
      model: 'MiniMax-H3-Image',
      prompt: 'a neon skyline at dusk',
      n: 2,
      response_format: 'b64_json',
      size: '1920x1080',
      output_format: 'webp',
      disable_prompt_enhanced: true,
    })

    const streamed = parseMiniMaxReq({
      model: 'minimax-h3-image-highspeed',
      prompt: 'studio portrait',
      aspect_ratio: '3:4',
      area: '4K',
      stream: true,
    })
    expect(buildMiniMaxImageRequest(streamed)).toEqual({
      model: 'MiniMax-H3-Image-Highspeed',
      prompt: 'studio portrait',
      n: 1,
      response_format: 'url',
      aspect_ratio: '3:4',
      area: '4K',
      stream: true,
    })

    const edit = parseMiniMaxReq({
      model: 'MiniMax-H3-Image',
      prompt: 'replace background with snow',
      image: ['https://example.com/ref.png'],
    }, 'edits')
    expect(buildMiniMaxImageRequest(edit)).toMatchObject({
      model: 'MiniMax-H3-Image',
      prompt: 'replace background with snow',
      images: [{ image_url: 'https://example.com/ref.png' }],
    })

    expect(() => buildMiniMaxImageRequest(parseMiniMaxReq({
      model: 'MiniMax-H3-Image',
      prompt: 'cat',
      stream: true,
      response_format: 'b64_json',
    }))).toThrow('response_format=url')

    expect(() => buildMiniMaxImageRequest(parseMiniMaxReq({
      model: 'MiniMax-H3-Image',
      prompt: 'cat',
      size: '1024x1024',
      aspect_ratio: '1:1',
    }))).toThrow('cannot combine explicit WIDTHxHEIGHT')

    expect(() => buildMiniMaxImageRequest(parseMiniMaxReq({
      model: 'MiniMax-H3-Image',
      prompt: 'cat',
      size: 'auto',
      disable_prompt_enhanced: true,
    }))).toThrow('disable_prompt_enhanced')

    expect(() => buildMiniMaxImageRequest(parseMiniMaxReq({
      model: 'MiniMax-H3-Image',
      prompt: 'cat',
      size: '5000x5000',
    }))).toThrow('20 megapixels')

    expect(() => buildMiniMaxImageRequest(parseMiniMaxReq({
      model: 'MiniMax-H3-Image',
      prompt: 'cat',
      size: '4000x1000',
    }))).toThrow('1:3 and 3:1')

    expect(() => buildMiniMaxImageRequest(parseMiniMaxReq({
      model: 'MiniMax-H3-Image',
      prompt: 'cat',
      quality: 'high',
    }))).toThrow('does not support quality')

    expect(() => buildMiniMaxImageRequest(parseMiniMaxReq({
      model: 'MiniMax-H3-Image',
      prompt: 'edit',
    }, 'edits'))).toThrow('image input is required')

    expect(() => buildMiniMaxImageRequest(parseMiniMaxReq({
      model: 'MiniMax-H3-Image',
      prompt: 'edit',
      image: Array.from({ length: 17 }, (_, i) => `https://example.com/${i}.png`),
    }, 'edits'))).toThrow('at most 16 images')

    expect(() => buildMiniMaxImageRequest(parseMiniMaxReq({
      model: 'MiniMax-H3-Image',
      prompt: 'edit',
      images: [{ file_id: 'file_123' }],
    }, 'edits'))).toThrow('instead of file_id')
  })

  it('relays image requests and turns network or URL failures into HTTP responses instead of throwing', async () => {
    const fetchMock = vi.fn(async () => Response.json({ created: 1, data: [{ url: 'https://cdn.example/out.png' }] }))
    vi.stubGlobal('fetch', fetchMock)

    const genReq = parseMiniMaxReq({
      model: 'MiniMax-H3-Image',
      prompt: 'sunset',
      stream: true,
    })
    await relayMiniMaxImages('mm-secret', genReq)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.minimaxi.com/v1/images/generations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer mm-secret',
          accept: 'text/event-stream',
        }),
      }),
    )

    const editReq = parseMiniMaxReq({
      model: 'MiniMax-H3-Image-Highspeed',
      prompt: 'add hat',
      images: [{ image_url: 'https://example.com/a.png' }],
    }, 'edits')
    await relayMiniMaxImages('mm-secret', editReq, 'https://api.minimax.io/v1')
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://api.minimax.io/v1/images/edits',
      expect.any(Object),
    )

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connect ETIMEDOUT https://api.minimaxi.com') }))
    const timeoutRes = await relayMiniMaxImages('mm-secret', genReq)
    expect(timeoutRes.status).toBe(502)
    await expect(timeoutRes.json()).resolves.toMatchObject({
      error: { type: 'upstream_error', code: 'image_generation_failed' },
    })

    const unsafeRes = await relayMiniMaxImages('mm-secret', genReq, 'http://127.0.0.1:8080')
    expect(unsafeRes.status).toBe(400)
  })

  it('parses MiniMax image token usage, detects billable work, and tracks SSE/JSON streams', () => {
    const parsed = parseMiniMaxImageUsage({
      data: [{ url: 'https://cdn.example/1.png', size: '2048x2048' }, { url: 'https://cdn.example/2.png' }],
      usage: {
        input_tokens: 1850,
        input_tokens_details: { text_tokens: 50, image_tokens: 1800 },
        output_tokens: 4096,
        output_tokens_details: { image_tokens: 4096 },
        generated_images: 2,
      },
    }, 'minimax-h3-image-highspeed')
    expect(parsed).toMatchObject({
      inputTokens: 50,
      outputTokens: 0,
      imageInputTokens: 1800,
      imageOutputTokens: 4096,
      imageCount: 2,
      imageModel: 'MiniMax-H3-Image-Highspeed',
      imageSize: '2048x2048',
      usageSource: 'upstream',
    })

    const derived = parseMiniMaxImageUsage({
      data: [{ b64_json: 'Zm9v' }],
      usage: { prompt_tokens: 600, input_tokens_details: { image_tokens: 512 }, completion_tokens: 2048 },
    })
    expect(derived).toMatchObject({
      inputTokens: 88,
      imageInputTokens: 512,
      imageOutputTokens: 2048,
      imageCount: 1,
      usageSource: 'upstream',
    })
    expect(parseMiniMaxImageUsage({ data: [{ url: 'https://cdn.example/only.png' }] })).toMatchObject({
      imageCount: 1,
      usageSource: 'partial',
    })

    expect(hasMiniMaxImageBillableWork({ data: [{ url: 'https://cdn.example/1.png' }] })).toBe(true)
    expect(hasMiniMaxImageBillableWork({ usage: { input_tokens: 100, output_tokens: 1024 } })).toBe(true)
    expect(hasMiniMaxImageBillableWork({ error: { code: 'bad_request' } })).toBe(false)

    const genReq = parseMiniMaxReq({ model: 'MiniMax-H3-Image', prompt: 'draw', stream: true })
    const sseGen = createMiniMaxImagesStreamParser(genReq)
    sseGen.feed({ type: 'image_generation.partial_succeeded', image_index: 0, url: 'https://cdn.example/0.png', size: '1024x1024' })
    sseGen.feed({
      type: 'image_generation.completed',
      usage: { input_tokens: 40, output_tokens: 2048, output_tokens_details: { image_tokens: 2048 } },
    })
    expect(sseGen.failure()).toBeNull()
    expect(sseGen.result()).toMatchObject({
      inputTokens: 40,
      imageOutputTokens: 2048,
      imageCount: 1,
      imageModel: 'MiniMax-H3-Image',
      imageSize: '1024x1024',
    })

    const editReq = parseMiniMaxReq({
      model: 'MiniMax-H3-Image-Highspeed',
      prompt: 'edit',
      images: [{ image_url: 'https://example.com/a.png' }],
      stream: true,
    }, 'edits')
    const sseEdit = createMiniMaxImagesStreamParser(editReq)
    sseEdit.feed({ type: 'image_edit.partial_succeeded', image_index: 0, url: 'https://cdn.example/edit.png', size: '1536x1024' })
    sseEdit.feed({
      type: 'image_edit.completed',
      usage: { input_tokens: 1000, input_tokens_details: { text_tokens: 100, image_tokens: 900 }, output_tokens: 2048 },
    })
    expect(sseEdit.failure()).toBeNull()
    expect(sseEdit.result()).toMatchObject({
      inputTokens: 100,
      imageInputTokens: 900,
      imageOutputTokens: 2048,
      imageCount: 1,
      imageModel: 'MiniMax-H3-Image-Highspeed',
      imageSize: '1536x1024',
    })

    const failedSse = createMiniMaxImagesStreamParser(genReq)
    failedSse.feed({ type: 'error', code: 'content_filter', message: 'blocked' })
    expect(failedSse.failure()).toEqual({ code: 'content_filter', message: 'blocked' })

    const emptySse = createMiniMaxImagesStreamParser(genReq)
    expect(emptySse.failure()).toMatchObject({ code: 'image_generation_no_output' })

    const partialJson = createMiniMaxImagesStreamParser(genReq)
    partialJson.feed({
      data: [{ url: 'https://cdn.example/ok.png' }, { error: { code: 'moderation_blocked', message: 'unsafe' } }],
      usage: { input_tokens: 20, output_tokens: 1024 },
    })
    expect(partialJson.failure()).toBeNull()
    expect(partialJson.result()).toMatchObject({ imageCount: 1, imageOutputTokens: 1024 })
  })
})
