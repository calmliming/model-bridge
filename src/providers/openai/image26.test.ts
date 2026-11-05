import { beforeEach, describe, expect, it, vi } from 'vitest'
const fetchUpstream = vi.hoisted(() => vi.fn())
vi.mock('../../http/upstream', () => ({ fetchWithConnectTimeout: fetchUpstream }))
import { buildNativeImageRequest, convertNativeImageResponse } from './directImages'
import { parseOpenAIImagesRequest, relayOpenaiImages } from './images'
import { IMAGE_26_MODELS } from './imageModels'
import { calculateUsageCost, estimateCost, resolvePrice } from '../../usage/pricing'
import { emptyUsage } from '../types'
import { bufferedUsageSource, createUsageSourceTracker } from '../usageSource'

const model = 'gpt-image-2.6-flare'
const request = (extra: Record<string, unknown> = {}, endpoint: 'generations' | 'edits' = 'generations') =>
  parseOpenAIImagesRequest({ model, prompt: 'Keep this drawing.', ...extra }, 'application/json', endpoint)
beforeEach(() => { vi.clearAllMocks() })

describe('GPT Image 2.6', () => {
  it.each(IMAGE_26_MODELS)('routes %s to native images and forwards complexity without internal fields', async model => {
    fetchUpstream.mockResolvedValue(new Response('{}'))
    await relayOpenaiImages('test-token', request({ model, complexity: 'medium', output_format: 'webp', background: 'transparent',
      instructions: 'private', internal: true, safety_identifier: 'hashed-user' }), 'account-26')
    const [url, init] = fetchUpstream.mock.calls[0]
    expect(url).toBe('https://chatgpt.com/backend-api/codex/images/generations')
    expect(init.headers['ChatGPT-Account-ID']).toBe('account-26')
    expect(JSON.parse(init.body)).toEqual({ model, prompt: 'Keep this drawing.', complexity: 'medium', output_format: 'webp', background: 'transparent', safety_identifier: 'hashed-user' })
    expect(resolvePrice('openai', model)).toMatchObject({ input: 5, output: 0, cacheRead: 1.25, imageInput: 8, imageCacheRead: 2, imageOutput: 30 })
    expect(resolvePrice('sub2api', model)).toEqual(resolvePrice('openai', model))
  })

  it('forwards GIF parameters, preserves GIF encoding and charges each animation once', () => {
    const parsed = request({ output_format: 'gif', size: '256x256', frame_count: '9', frame_duration_ms: '200', complexity: 'low' })
    expect(buildNativeImageRequest(parsed)).toMatchObject({ output_format: 'gif', frame_count: 9, frame_duration_ms: 200, size: '256x256', complexity: 'low' })
    const result = convertNativeImageResponse(JSON.stringify({ data: [{ b64_json: 'R0lGODlh' }], usage: { output_tokens: 900 } }), { ...parsed, response_format: 'url' })
    expect(result.body).toMatchObject({ output_format: 'gif', data: [{ url: 'data:image/gif;base64,R0lGODlh' }] })
    expect(result.usage).toMatchObject({ imageCount: 1, imageOutputTokens: 900 })
    expect(estimateCost('openai', model, result.usage)).toBe(0.027)
  })

  it('retains SVG author usage and bills it separately from the reference image', () => {
    const parsed = request({ output_format: 'svg', svg: { model: 'gpt-6-luna', reasoning: { effort: 'high' } } })
    expect(buildNativeImageRequest(parsed)).toMatchObject({ svg: { model: 'gpt-6-luna', reasoning: { effort: 'high' } } })
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')
    const svgUsage = { model: 'gpt-6-luna', input_tokens: 100, output_tokens: 50, reasoning_tokens: 20 }
    const result = convertNativeImageResponse(JSON.stringify({ data: [{ b64_json: svg }], usage: { input_tokens: 100, output_tokens: 1000 }, svg_usage: svgUsage }), { ...parsed, response_format: 'url' })
    expect(result.body).toMatchObject({ output_format: 'svg', svg_usage: svgUsage, data: [{ url: `data:image/svg+xml;base64,${svg}` }] })
    expect(result.usage.svgUsage).toEqual({ model: 'gpt-6-luna', inputTokens: 100, outputTokens: 50, reasoningTokens: 20 })
    expect(estimateCost('openai', model, result.usage)).toBe(0.030535)
    const price = { input: 5, output: 0, cacheRead: 1.25, cacheWrite: 0, imageRequest: 0.1 }
    expect(calculateUsageCost('openai', model, { ...result.usage, imageBillingMode: 'per_image' }, undefined, price)).toBe(0.1)
  })

  it('preserves author usage on a failed SVG response for settlement without an image', () => {
    const result = convertNativeImageResponse(JSON.stringify({ error: { code: 'rate_limit_exceeded', message: 'Stopped' },
      svg_usage: { model: 'gpt-6-luna', input_tokens: 100, output_tokens: 50 } }), request({ output_format: 'svg' }))
    expect(result).toMatchObject({ status: 'error', httpStatus: 429, usage: { imageCount: 0, svgUsage: { inputTokens: 100, outputTokens: 50 } } })
    expect(estimateCost('openai', model, result.usage)).toBe(0.000035)
    expect(calculateUsageCost('openai', model, emptyUsage())).toBe(0)
    expect(bufferedUsageSource(JSON.stringify({ svg_usage: { model: 'gpt-6-luna', input_tokens: 100, output_tokens: 50 } }), false)).toBe('upstream')
    const tracker = createUsageSourceTracker()
    tracker.feed({ type: 'image_edit.completed', usage: { input_tokens: 0, output_tokens: 0 } })
    expect(tracker.source()).toBe('upstream')
  })

  it('forwards multipart markup as a PNG reference on native edits', () => {
    const parts = [['model', model, ''], ['prompt', 'Change the marked region', ''], ['complexity', 'low', ''],
      ['image', 'source', '; filename="source.png"'], ['markup', 'overlay', '; filename="markup.png"']]
      .map(([field, value, filename]) => `--boundary\r\nContent-Disposition: form-data; name="${field}"${filename}\r\nContent-Type: image/png\r\n\r\n${value}\r\n`).join('') + '--boundary--\r\n'
    const parsed = parseOpenAIImagesRequest(Buffer.from(parts), 'multipart/form-data; boundary=boundary', 'edits')
    expect(buildNativeImageRequest(parsed)).toMatchObject({ complexity: 'low', images: [{ image_url: 'data:image/png;base64,c291cmNl' }], markup: { image_url: 'data:image/png;base64,b3ZlcmxheQ==' } })
  })

  it.each([
    { model: 'gpt-image-2.6' }, { model: 'gpt-image-2.6-unknown' }, { complexity: 'max' },
    { model: 'gpt-image-2.5-flare', output_format: 'gif' },
    { output_format: 'gif', stream: true }, { output_format: 'svg', stream: true },
    { output_format: 'gif', partial_images: 1 }, { output_format: 'svg', output_compression: 50 },
    { output_format: 'svg', n: 2 }, { output_format: 'svg', prompt_rewriter: false },
    { output_format: 'gif', frame_count: 1 }, { output_format: 'gif', frame_count: 17 },
    { output_format: 'gif', frame_duration_ms: 19 }, { output_format: 'gif', frame_duration_ms: 2001 },
    { output_format: 'gif', frame_count: 2.5 }, { output_format: 'gif', size: '0x256' },
    { output_format: 'gif', size: '257x256' }, { output_format: 'gif', size: '999999999999999999x256' },
    { frame_count: 9 }, { frame_duration_ms: 200 },
    { output_format: 'svg', background: 'transparent' }, { output_format: 'svg', svg: { reasoning: {} } },
    { output_format: 'svg', svg: { model: 'gpt-6-luna', reasoning: { effort: 'invalid' } } },
    { svg: { model: 'gpt-6-luna' } }, { safety_identifier: 'a'.repeat(129) },
  ])('rejects invalid parameters before an upstream call: %j', body => {
    expect(() => request(body)).toThrow()
    expect(fetchUpstream).not.toHaveBeenCalled()
  })

  it.each([
    { output_format: 'svg' }, { output_format: 'gif' },
    { markup: { image_url: 'data:image/png;base64,AAAA' }, mask: { image_url: 'data:image/png;base64,BBBB' } },
    { markup: { image_url: 'https://example.com/markup.png', file_id: 'file-1' } },
    { markup: { file_id: 'file-1' } }, { markup: { image_url: 'data:image/svg+xml;base64,AAAA' } },
  ])('rejects unsupported edit combinations: %j', body => {
    expect(() => request({ images: [{ image_url: 'data:image/png;base64,AAAA' }], ...body }, 'edits')).toThrow()
  })
})
