import { beforeEach, describe, expect, it, vi } from 'vitest'
const fetchUpstream = vi.hoisted(() => vi.fn())
vi.mock('../../http/upstream', () => ({ fetchWithConnectTimeout: fetchUpstream }))
import { buildNativeImageRequest, convertNativeImageResponse, createNativeImagesStreamTransform, createNativeImagesUsageParser, parseNativeImageUsage, relayNativeImages } from './directImages'
import { parseOpenAIImagesRequest, relayOpenaiImages } from './images'
import { IMAGE_25_MODELS } from './imageModels'
import { estimateCost, resolvePrice } from '../../usage/pricing'

const model = 'gpt-image-2.5-flare'
const reportedUsage = { input_tokens: 1000, output_tokens: 500, input_tokens_details: {
  image_tokens: 600, cached_tokens: 300, cached_tokens_details: { image_tokens: 200, text_tokens: 100 },
} }
const request = (extra = {}, endpoint: 'generations' | 'edits' = 'generations') => parseOpenAIImagesRequest({ model, prompt: '  Keep this prompt.\n', ...extra }, 'application/json', endpoint)
const sse = (events: unknown[]) => events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
beforeEach(() => { vi.clearAllMocks() })

describe('Image 2.5 native requests', () => {
  it.each(IMAGE_25_MODELS)('sends %s directly to Codex Images with image parameters only', async model => {
    fetchUpstream.mockResolvedValue(new Response('{}'))
    const body = request({ model, quality: 'max', background: 'transparent', output_format: 'webp', size: '1536x864',
      internal_secret: 'must-not-forward', instructions: 'must-not-forward', n: 2 })
    await relayOpenaiImages('fake-token', body, 'account-1')
    const [url, init] = fetchUpstream.mock.calls[0]
    expect(url).toBe('https://chatgpt.com/backend-api/codex/images/generations')
    expect(init.headers['openai-beta']).toBeUndefined()
    expect(init.headers['ChatGPT-Account-ID']).toBe('account-1')
    expect(JSON.parse(init.body)).toEqual({ model, prompt: '  Keep this prompt.\n', quality: 'max', background: 'transparent', output_format: 'webp', size: '1536x864', n: 2 })
  })
  it('normalizes multipart edits and masks into native JSON', () => {
    const parts = [
      ['model', model, ''], ['prompt', 'Edit it', ''], ['quality', 'xhigh', ''],
      ['image', 'image-bytes', '; filename="image.png"'], ['mask', 'mask-bytes', '; filename="mask.png"'],
    ].map(([key, value, filename]) => `--boundary\r\nContent-Disposition: form-data; name="${key}"${filename}\r\nContent-Type: image/png\r\n\r\n${value}\r\n`).join('') + '--boundary--\r\n'
    const parsed = parseOpenAIImagesRequest(Buffer.from(parts), 'multipart/form-data; boundary=boundary', 'edits')
    expect(buildNativeImageRequest(parsed)).toEqual({ model, prompt: 'Edit it', quality: 'xhigh',
      images: [{ image_url: `data:image/png;base64,${Buffer.from('image-bytes').toString('base64')}` }],
      mask: { image_url: `data:image/png;base64,${Buffer.from('mask-bytes').toString('base64')}` } })
  })
  it.each([
    { quality: 'ultra' }, { size: '13x13' }, { background: 'transparent', output_format: 'jpeg' },
    { model: 'gpt-image-2.5-unknown' }, { images: [{ file_id: 'file-1' }] },
  ])('rejects invalid native parameters before contacting an upstream: %j', extra => {
    expect(() => request(extra)).toThrow()
    expect(fetchUpstream).not.toHaveBeenCalled()
  })
  it('keeps legacy Image 2 on its existing bridge and transparency rule', async () => {
    expect(() => request({ model: 'gpt-image-2', background: 'transparent' })).toThrow()
    fetchUpstream.mockResolvedValue(new Response('{}'))
    await relayOpenaiImages('fake-token', request({ model: 'gpt-image-2' }))
    expect(fetchUpstream.mock.calls[0][0]).toBe('https://chatgpt.com/backend-api/codex/responses')
  })
})

describe('native image responses and billing', () => {
  it('partitions image and text cache reads exactly once at independent rates', () => {
    const usage = parseNativeImageUsage(reportedUsage)
    expect(usage).toMatchObject({ inputTokens: 300, cacheReadTokens: 100, imageInputTokens: 400, imageCacheReadTokens: 200, imageOutputTokens: 500, outputTokens: 0 })
    expect(estimateCost('openai', model, usage)).toBe(0.020225)
    for (const id of IMAGE_25_MODELS) expect(resolvePrice('sub2api', id)).toMatchObject({ input: 5, output: 0, cacheRead: 1.25, imageInput: 8, imageCacheRead: 2, imageOutput: 30 })
  })
  it('bounds inconsistent token counts and only trusts explicit image cache details', () => {
    const usage = parseNativeImageUsage({ input_tokens: 10, output_tokens: -1, input_tokens_details: { image_tokens: 40, cached_tokens: 50, cached_tokens_details: { image_tokens: 100 } } })
    expect(usage).toMatchObject({ inputTokens: 0, cacheReadTokens: 0, imageInputTokens: 0, imageCacheReadTokens: 10, imageOutputTokens: 0 })
    expect(parseNativeImageUsage({ input_tokens: 10, input_tokens_details: { image_tokens: 5, cached_tokens: 3 } })).toMatchObject({ imageCacheReadTokens: 0, cacheReadTokens: 3, imageInputTokens: 5, inputTokens: 2 })
  })
  it('retains JSON metadata and converts base64 to a data URL without downloading anything', () => {
    const result = convertNativeImageResponse(JSON.stringify({ created: 123, data: [{ b64_json: 'AAAA', revised_prompt: 'Keep' }], output_format: 'webp', usage: reportedUsage }), request({ response_format: 'url' }))
    expect(result.body).toMatchObject({ created: 123, data: [{ url: 'data:image/webp;base64,AAAA', revised_prompt: 'Keep' }], usage: reportedUsage })
    expect(result.usage).toMatchObject({ imageCount: 1, imageCacheReadTokens: 200 })
  })
  it('does not count partial images or repeated completion frames twice', () => {
    const completed = { type: 'image_generation.completed', b64_json: 'BBBB', usage: reportedUsage }
    const stream = sse([{ type: 'image_generation.partial_image', b64_json: 'AAAA', partial_image_index: 0 }, completed, completed])
    const result = convertNativeImageResponse(stream, request())
    expect(result.usage).toMatchObject({ imageCount: 1, imageOutputTokens: 500 })
    expect(result.body).toMatchObject({ data: [{ b64_json: 'BBBB' }] })
  })
  it('reports incomplete streams and preserves reported usage on failure', () => {
    const parser = createNativeImagesUsageParser(request())
    parser.feed({ type: 'image_generation.partial_image', b64_json: 'AAAA', usage: reportedUsage })
    expect(parser.failure()?.code).toBe('image_generation_no_output')
    expect(parser.result().imageCacheReadTokens).toBe(200)
    const transform = createNativeImagesStreamTransform(request())
    transform.transform({ type: 'image_generation.partial_image', b64_json: 'AAAA' })
    expect(transform.flush()).toMatchObject([{ event: 'error' }])
    expect(transform.status()).toBe('error')
    expect(convertNativeImageResponse(JSON.stringify({ error: { code: 'content_policy_violation', message: 'Blocked' }, usage: reportedUsage }), request())).toMatchObject({ httpStatus: 400, status: 'error', usage: { imageOutputTokens: 500 } })
  })
  it('adapts a JSON fallback into requested native SSE even with response_format=url', async () => {
    fetchUpstream.mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: 'AAAA' }], usage: reportedUsage }), { headers: { 'content-type': 'application/json', 'x-request-id': 'req-image' } }))
    const response = await relayNativeImages('fake', request({ stream: true, response_format: 'url' }))
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(response.headers.get('x-request-id')).toBe('req-image')
    expect(convertNativeImageResponse(await response.text(), request({ response_format: 'url' }))).toMatchObject({ usage: { imageCount: 1, imageOutputTokens: 500 }, body: { data: [{ url: 'data:image/png;base64,AAAA' }] } })
  })
})
