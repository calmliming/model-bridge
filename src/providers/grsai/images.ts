import { fetchWithConnectTimeout } from '../../http/upstream'
import { redactUpstreamError } from '../../http/upstreamDiagnostics'
import { emptyUsage, type UsageData } from '../types'
import type { OpenAIImagesRequestBody, NamedSseEvent } from '../openai/images'
import { ProviderRequestError } from '../requestError'
import { boundedBody, generateGrsai, GrsaiUpstreamError, parseGrsaiGenerateRequest } from './client'
import { isGrsaiImageModel } from './models'
import { publicMediaError } from '../publicIdentity'

export function buildGrsaiImageRequest(body: OpenAIImagesRequestBody) {
  if (!isGrsaiImageModel(body.model)) throw new ProviderRequestError('invalid_image_model', 'unsupported GPT Image model')
  if (body.n !== 1) throw new ProviderRequestError('invalid_image_request', 'image generation supports n=1; submit separate requests for multiple images')
  if (body.images.some(image => image.file_id)) throw new ProviderRequestError('invalid_image_request', 'image edits require image URLs or base64 instead of file_id')
  for (const field of ['output_format', 'output_compression', 'partial_images', 'moderation', 'input_fidelity', 'style']) {
    if (body[field] != null) throw new ProviderRequestError('invalid_image_request', `image generation does not support ${field}`)
  }
  return parseGrsaiGenerateRequest({ model: body.model, prompt: body.prompt, replyType: 'json',
    images: body.images.map(image => image.image_url!), aspectRatio: body.size ?? body.aspectRatio ?? 'auto',
    ...(body.quality ? { quality: body.quality } : {}), ...(body.background ? { background: body.background } : {}),
    ...(body.mask ? { mask: body.mask.image_url } : {}) })
}

const prefix = (body: OpenAIImagesRequestBody) => body.__image_endpoint === 'edits' ? 'image_edit' : 'image_generation'

export async function relayGrsaiImages(token: string, body: OpenAIImagesRequestBody, baseUrl?: string | null): Promise<Response> {
  const input = buildGrsaiImageRequest(body)
  try {
    const result = await generateGrsai(token, input, baseUrl)
    if (result.status !== 'succeeded') return Response.json({ error: { type: 'upstream_error', code: result.status,
      message: publicMediaError(result.error || 'Image generation failed') } }, { status: result.status === 'violation' ? 400 : 502 })
    const data: Array<{ url: string } | { b64_json: string }> = []
    for (const entry of result.results) {
      if (body.response_format === 'url') { data.push(entry); continue }
      // The media URL is untrusted. Use the same DNS, redirect and private-network
      // guards as upstream APIs, and never attach the supplier credential.
      const response = await fetchWithConnectTimeout(entry.url, { signal: AbortSignal.timeout(30_000) })
      if (!response.ok || !(response.headers.get('content-type') ?? '').startsWith('image/')) {
        await response.body?.cancel()
        throw new GrsaiUpstreamError(502, 'Unable to download the generated image; retry with response_format=url')
      }
      data.push({ b64_json: (await boundedBody(response, 30 * 1024 * 1024)).toString('base64') })
    }
    const usage = { image_count: data.length }
    if (!body.stream) return Response.json({ created: Math.floor(Date.now() / 1000), data, usage })
    const type = `${prefix(body)}.completed`
    const events = data.map((entry, image_index) => ({ ...entry, type, image_index, model: body.model,
      created_at: Math.floor(Date.now() / 1000), ...(image_index === data.length - 1 ? { usage } : {}) }))
    return new Response(events.map(event => `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
  } catch (error) {
    return Response.json({ error: { type: 'upstream_error', code: 'image_generation_failed',
      message: publicMediaError(error instanceof GrsaiUpstreamError ? error.message : 'Image generation is temporarily unavailable') } },
      { status: error instanceof GrsaiUpstreamError ? error.statusCode : 502 })
  }
}

export function grsaiImageUsage(raw: unknown): UsageData {
  const value = raw as { data?: unknown[]; usage?: { image_count?: number } } | null
  const count = value?.data?.length ?? value?.usage?.image_count ?? 0
  return { ...emptyUsage(), imageCount: count, usageSource: count ? 'upstream' : 'missing' }
}

export function createGrsaiImageStream(body: OpenAIImagesRequestBody) {
  const images = new Set<number>()
  return {
    feed(raw: unknown) {
      const row = raw as { type?: string; image_index?: number; url?: string; b64_json?: string } | null
      if (row?.type === `${prefix(body)}.completed` && (row.url || row.b64_json)) images.add(row.image_index ?? 0)
    },
    result: (): UsageData => ({ ...emptyUsage(), imageCount: images.size, imageModel: body.model,
      imageSize: typeof body.size === 'string' ? body.size : undefined, usageSource: images.size ? 'upstream' : 'missing' }),
    transform: (raw: unknown): NamedSseEvent[] => [{ __modelBridgeSseEvent: true, event: (raw as { type: string }).type, data: raw }],
    flush: (): unknown[] => images.size ? [] : [{ __modelBridgeSseEvent: true, event: 'error', data: { type: 'error', error: { code: 'image_generation_no_output', message: 'No final image received' } } }],
  }
}
