import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), mediaFetch: vi.fn() }))
vi.mock('../../http/upstream', () => ({ fetchWithConnectTimeout: mocks.fetch, fetchPublicMedia: mocks.mediaFetch }))
import { grsaiBaseUrl, parseGrsaiGenerateRequest, generateGrsai, queryGrsaiResult, parseGrsaiResult, testGrsai } from './client'
import { buildGrsaiImageRequest, createGrsaiImageStream, grsaiImageUsage, relayGrsaiImages } from './images'
import { parseOpenAIImagesRequest } from '../openai/images'
import { estimateCost } from '../../usage/pricing'
import { emptyUsage } from '../types'
import { inferProviderForModel, listModelIdsForKey, listOpenAIStyleModels } from '../modelDiscovery'

const video = { model: 'minimax-h3', prompt: 'camera follows a cat', aspectRatio: 'landscape', resolution: '768p', duration: 10 }
const image = (fields = {}) => parseOpenAIImagesRequest({ model: 'gpt-image-2.5-flare', prompt: 'cat', response_format: 'url', ...fields }, 'application/json', 'generations', { deferModelValidation: true })
const completed = { id: 'supplier-task-1', status: 'succeeded', results: [{ url: 'https://files.example.com/image.png' }] }
beforeEach(() => { vi.resetAllMocks() })

describe('GrsAI parameters', () => {
  it('normalizes documented nodes and suffixes while rejecting unsafe URLs', () => {
    expect(grsaiBaseUrl()).toBe('https://grsai.dakka.com.cn')
    expect(grsaiBaseUrl('https://grsaiapi.com/v1/api/')).toBe('https://grsaiapi.com')
    expect(() => grsaiBaseUrl('http://127.0.0.1')).toThrow()
    expect(() => grsaiBaseUrl('https://grsaiapi.com?key=secret')).toThrow()
    expect(() => grsaiBaseUrl('https://user:secret@grsaiapi.com')).toThrow()
  })
  it('accepts H3 references and validates the resolution-dependent duration', () => {
    expect(parseGrsaiGenerateRequest({ ...video, images: ['https://example.com/input.png'], audios: ['data:audio/mpeg;base64,YQ=='], seed: 1 })).toMatchObject(video)
    expect(() => parseGrsaiGenerateRequest({ ...video, resolution: '1080p', duration: 15 })).toThrow('at most 10')
    expect(() => parseGrsaiGenerateRequest({ ...video, duration: '10' })).toThrow()
    expect(() => parseGrsaiGenerateRequest({ ...video, images: Array(10).fill('https://example.com/a.png') })).toThrow()
    expect(() => parseGrsaiGenerateRequest({ ...video, aspectRatio: '16:9' })).toThrow()
    expect(() => parseGrsaiGenerateRequest({ ...video, webHook: 'https://other.example.com' })).toThrow()
  })
  it('validates supplier image variants independently from OAuth image models', () => {
    expect(parseGrsaiGenerateRequest({ model: 'gpt-image-2.5', prompt: 'cat', aspectRatio: '16:9' }).model).toBe('gpt-image-2.5')
    expect(() => parseGrsaiGenerateRequest({ model: 'gpt-image-2.5', prompt: 'cat', aspectRatio: '2048x2048' })).toThrow('1K')
    expect(() => parseGrsaiGenerateRequest({ model: 'gpt-image-2.5-flare', prompt: 'cat', aspectRatio: '16:9' })).toThrow('WIDTHxHEIGHT')
    expect(() => parseGrsaiGenerateRequest({ model: 'gpt-image-2.5-flare', prompt: 'cat', quality: 'max' })).toThrow('quality')
    expect(parseGrsaiGenerateRequest({ model: 'gpt-image-2.5-sunburst', prompt: 'cat', quality: 'max', aspectRatio: '2880x2880', background: 'transparent' }).quality).toBe('max')
  })
  it.each(['auto', '16:9', '1024x1024', '1536x1024'])('accepts Image 2.6 basic parameters with size=%s', size => {
    expect(buildGrsaiImageRequest(image({ model: 'gpt-image-2.6', quality: 'auto', size })))
      .toMatchObject({ model: 'gpt-image-2.6', quality: 'auto', aspectRatio: size, replyType: 'json' })
  })
  it.each([
    [{ size: '2048x2048' }, '1K'],
    [{ quality: 'high' }, 'quality'],
    [{ background: 'transparent' }, 'transparent'],
    [{ n: 2 }, 'n=1'],
    [{ output_format: 'gif' }, 'output_format'],
    [{ frame_count: 9 }, 'frame_count'],
    [{ frame_duration_ms: 200 }, 'frame_duration_ms'],
    [{ complexity: 'high' }, 'complexity'],
    [{ markup: { image_url: 'https://example.com/markup.png' } }, 'markup'],
    [{ prompt_rewriter: true }, 'prompt_rewriter'],
    [{ svg: { model: 'gpt-6-luna' } }, 'svg'],
  ] as const)('rejects unsupported Image 2.6 basic fields %j before generation', (fields, error) => {
    expect(() => buildGrsaiImageRequest(image({ model: 'gpt-image-2.6', ...fields }))).toThrow(error)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('translates edits and rejects unsupported parameters before generation', () => {
    const edit = parseOpenAIImagesRequest({ model: 'gpt-image-2-vip', prompt: 'edit', images: ['https://example.com/input.png'], mask: 'data:image/png;base64,YQ==', quality: 'medium', size: '2048x2048' }, 'application/json', 'edits', { deferModelValidation: true })
    expect(buildGrsaiImageRequest(edit)).toMatchObject({ images: ['https://example.com/input.png'], mask: 'data:image/png;base64,YQ==', aspectRatio: '2048x2048', replyType: 'json' })
    expect(() => buildGrsaiImageRequest(image({ n: 2 }))).toThrow('n=1')
    expect(() => buildGrsaiImageRequest(image({ partial_images: 1 }))).toThrow('partial_images')
  })
})

describe('GrsAI transport', () => {
  it('uses Bearer authentication and the unified generate/result API', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ id: 'supplier-task-1', status: 'running' }))
      .mockResolvedValueOnce(Response.json(completed))
    await generateGrsai('supplier-secret', { ...parseGrsaiGenerateRequest(video), replyType: 'async' })
    const [url, init] = mocks.fetch.mock.calls[0]!
    expect(url).toBe('https://grsai.dakka.com.cn/v1/api/generate')
    expect(init.headers.authorization).toBe('Bearer supplier-secret')
    expect(JSON.parse(init.body)).toMatchObject({ model: 'minimax-h3', replyType: 'async' })
    await queryGrsaiResult('supplier-secret', 'supplier-task-1')
    expect(mocks.fetch.mock.calls[1]![0]).toBe('https://grsai.dakka.com.cn/v1/api/result?id=supplier-task-1')
  })
  it('rejects malformed successes and wrong task IDs without leaking errors', async () => {
    expect(() => parseGrsaiResult({ ...completed, results: [] })).toThrow('without media')
    mocks.fetch.mockResolvedValueOnce(Response.json({ ...completed, id: 'different-id' }))
    await expect(queryGrsaiResult('secret', 'supplier-task-1')).rejects.toThrow('different task ID')
    mocks.fetch.mockResolvedValueOnce(Response.json({ error: { message: 'Bearer sk-abcdefghijkl https://secret.example.com' } }, { status: 401 }))
    await expect(generateGrsai('secret', parseGrsaiGenerateRequest(video))).rejects.toThrow('Bearer [redacted] [redacted-url]')
  })
  it('preserves proxy HTTP errors when the response is HTML and never retries generation', async () => {
    for (const status of [401, 503, 504]) {
      mocks.fetch.mockResolvedValueOnce(new Response('<!DOCTYPE html><html>proxy error</html>', { status }))
      await expect(generateGrsai('secret', parseGrsaiGenerateRequest(video))).rejects.toMatchObject({ statusCode: status })
    }
    expect(mocks.fetch).toHaveBeenCalledTimes(3)
  })
  it('returns compatible URL responses and completion SSE, without downloading media', async () => {
    mocks.fetch.mockImplementation(async () => Response.json(completed))
    const json = await relayGrsaiImages('secret', image())
    const body = await json.json() as { data: unknown[] }
    expect(body.data).toEqual(completed.results)
    expect(grsaiImageUsage(body).imageCount).toBe(1)
    const stream = await relayGrsaiImages('secret', image({ stream: true }))
    expect(stream.headers.get('content-type')).toBe('text/event-stream')
    expect(await stream.text()).toContain('event: image_generation.completed')
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    const parser = createGrsaiImageStream(image())
    parser.feed({ type: 'image_generation.completed', image_index: 0, url: completed.results[0]!.url })
    parser.feed({ type: 'image_generation.completed', image_index: 0, url: completed.results[0]!.url })
    expect(parser.result().imageCount).toBe(1)
    expect(parser.flush()).toEqual([])
  })
  it('downloads base64 media through the guarded transport without a supplier token', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json(completed))
    mocks.mediaFetch.mockResolvedValueOnce(new Response('image-bytes', { headers: { 'content-type': 'image/png' } }))
    const response = await relayGrsaiImages('secret', image({ response_format: 'b64_json' }))
    expect((await response.json() as { data: unknown[] }).data).toEqual([{ b64_json: Buffer.from('image-bytes').toString('base64') }])
    expect(mocks.fetch).toHaveBeenCalledOnce()
    expect(mocks.mediaFetch).toHaveBeenCalledExactlyOnceWith(completed.results[0]!.url, expect.any(AbortSignal))
  })
  it.each(['url', 'b64_json'])('preserves Image 2.6 GIF output for response_format=%s', async response_format => {
    const url = 'https://files.example.com/animation.gif'
    const gif = Buffer.from('GIF89a')
    mocks.fetch.mockResolvedValueOnce(Response.json({ ...completed, results: [{ url }] }))
    mocks.mediaFetch.mockResolvedValueOnce(new Response(gif, { headers: { 'content-type': 'image/gif' } }))
    const response = await relayGrsaiImages('secret', image({ model: 'gpt-image-2.6', quality: 'auto', response_format }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: response_format === 'url' ? [{ url }] : [{ b64_json: gif.toString('base64') }], usage: { image_count: 1 } })
    expect(JSON.parse(mocks.fetch.mock.calls[0]![1].body)).toMatchObject({ model: 'gpt-image-2.6', quality: 'auto' })
    expect(mocks.mediaFetch).toHaveBeenCalledTimes(response_format === 'url' ? 0 : 1)
  })
  it('fails closed when a generated image URL is rejected by the public-only downloader', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json(completed))
    mocks.mediaFetch.mockRejectedValueOnce(new Error('upstream URL resolves to a non-public address'))
    const response = await relayGrsaiImages('supplier-secret', image({ response_format: 'b64_json' }))
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('supplier-secret')
    expect(mocks.fetch).toHaveBeenCalledOnce()
    expect(mocks.mediaFetch).toHaveBeenCalledOnce()
  })
  it('turns failed generation into an error response and never retries submission', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ id: 'supplier-task-1', status: 'failed', error: 'generate failed' }, { status: 400 }))
    expect((await relayGrsaiImages('secret', image())).status).toBe(502)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('tests authentication via a missing task without invoking generation', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ error: 'task not found' }, { status: 400 }))
    await expect(testGrsai('secret')).resolves.toBeUndefined()
    expect(mocks.fetch.mock.calls[0]![0]).toContain('/v1/api/result?')
    mocks.fetch.mockResolvedValueOnce(Response.json({ error: 'invalid API key' }, { status: 401 }))
    await expect(testGrsai('wrong')).rejects.toThrow('无效')
  })
})

describe('GrsAI discovery and media prices', () => {
  it('advertises image models under a supplier-only key and preserves mapped aliases', () => {
    const key = { allowedProviders: ['grsai'], allowedModels: null, modelMappings: { picture: 'gpt-image-2' } }
    expect(listModelIdsForKey(key)).toContain('minimax-h3')
    expect(listModelIdsForKey(key)).toContain('gpt-image-2.5-flare')
    expect(listModelIdsForKey(key)).toContain('gpt-image-2.6')
    expect(listModelIdsForKey(key)).toContain('picture')
    expect(listOpenAIStyleModels(key).every(model => model.owned_by === 'modelbridge')).toBe(true)
    expect(listModelIdsForKey({ ...key, groupAllowedModels: ['minimax-h3'] })).toEqual(['minimax-h3'])
  })
  it('discovers Image 2.6 basic and aliases under the media provider while keeping native variants on OpenAI', () => {
    const key = { allowedProviders: ['openai', 'grsai'], allowedModels: ['gpt-image-2.6', 'picture'], modelMappings: { picture: 'gpt-image-2.6' } }
    expect(inferProviderForModel('gpt-image-2.6')).toBe('grsai')
    expect(inferProviderForModel('gpt-image-2.6-flare')).toBe('openai')
    expect(inferProviderForModel('gpt-image-2.6-sunburst')).toBe('openai')
    expect(listOpenAIStyleModels(key)).toEqual([
      expect.objectContaining({ id: 'gpt-image-2.6', owned_by: 'modelbridge' }),
      expect.objectContaining({ id: 'picture', owned_by: 'modelbridge' }),
    ])
    expect(listModelIdsForKey(key, 'openai')).toEqual([])
    expect(listModelIdsForKey({ ...key, groupAllowedModels: ['picture'] })).toEqual(['picture'])
  })
  it('bills images per request and H3 per resolution/second without token prices', () => {
    expect(estimateCost('grsai', 'gpt-image-2.5', { ...emptyUsage(), imageCount: 1 })).toBe(0.0042)
    expect(estimateCost('grsai', 'gpt-image-2.6', { ...emptyUsage(), imageCount: 1 })).toBe(0.0042)
    expect(estimateCost('grsai', 'gpt-image-2.6', { ...emptyUsage(), imageCount: 3 })).toBe(0.0042)
    expect(estimateCost('grsai', 'gpt-image-2.6', emptyUsage())).toBe(0)
    expect(estimateCost('grsai', 'gpt-image-2.5-flare', { ...emptyUsage(), imageCount: 1 })).toBe(0.014)
    expect(estimateCost('grsai', 'minimax-h3', { ...emptyUsage(), videoSeconds: 10, videoResolution: '1080p' })).toBe(0.21)
    expect(estimateCost('grsai', 'minimax-h3', { ...emptyUsage(), videoSeconds: 5, videoResolution: '768p' })).toBe(0.049)
    expect(estimateCost('grsai', 'minimax-h3', emptyUsage())).toBe(0)
  })
})
