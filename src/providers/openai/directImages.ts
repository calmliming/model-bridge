import { createHash, randomUUID } from 'node:crypto'
import { fetchWithConnectTimeout } from '../../http/upstream'
import { CODEX_ORIGINATOR, CODEX_USER_AGENT } from './constants'
import { emptyUsage, type UsageData } from '../types'
import type { BufferedImageConversion, NamedSseEvent, OpenAIImagesRequestBody } from './images'

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function text(value: unknown): string { return typeof value === 'string' ? value : '' }
function tokens(value: unknown): number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0 }
const prefix = (request: OpenAIImagesRequestBody) => request.__image_endpoint === 'edits' ? 'image_edit' : 'image_generation'

/** Native image outputs are image tokens; input buckets are mutually exclusive. */
export function parseNativeImageUsage(value: unknown): UsageData {
  const source = object(value)
  const details = object(source?.input_tokens_details)
  const cached = object(details?.cached_tokens_details)
  const total = tokens(source?.input_tokens)
  const imageTotal = Math.min(tokens(details?.image_tokens), total)
  const cacheTotal = Math.min(details?.cached_tokens == null
    ? tokens(cached?.text_tokens) + tokens(cached?.image_tokens) : tokens(details.cached_tokens), total)
  const imageCached = Math.min(tokens(cached?.image_tokens), imageTotal, cacheTotal)
  const imageInput = Math.min(imageTotal - imageCached, total - cacheTotal)
  return { ...emptyUsage(), inputTokens: total - cacheTotal - imageInput,
    cacheReadTokens: cacheTotal - imageCached, imageCacheReadTokens: imageCached,
    imageInputTokens: imageInput, imageOutputTokens: tokens(source?.output_tokens) }
}

export function buildNativeImageRequest(request: OpenAIImagesRequestBody): Record<string, unknown> {
  const body: Record<string, unknown> = { model: request.model, prompt: request.prompt }
  for (const key of ['size', 'quality', 'background', 'output_format', 'moderation', 'input_fidelity'] as const) {
    if (typeof request[key] === 'string' && request[key]) body[key] = request[key].trim()
  }
  for (const key of ['output_compression', 'partial_images'] as const) {
    if (typeof request[key] === 'number') body[key] = request[key]
  }
  if (request.n > 1) body.n = request.n
  if (request.stream) body.stream = true
  if (request.__image_endpoint === 'edits') {
    body.images = request.images.map(image => ({ image_url: image.image_url }))
    if (request.mask) body.mask = { image_url: request.mask.image_url }
  }
  return body
}

export async function relayNativeImages(token: string, request: OpenAIImagesRequestBody, accountId?: string): Promise<Response> {
  const response = await fetchWithConnectTimeout(`https://chatgpt.com/backend-api/codex/images/${request.__image_endpoint}`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json',
      accept: request.stream ? 'text/event-stream' : 'application/json',
      'user-agent': CODEX_USER_AGENT, originator: CODEX_ORIGINATOR, session_id: randomUUID(),
      ...(accountId && /^[\w-]{1,200}$/.test(accountId) ? { 'ChatGPT-Account-ID': accountId } : {}) },
    body: JSON.stringify(buildNativeImageRequest(request)),
  }, 300_000)
  // Some upstream accounts return JSON despite stream=true. Preserve the
  // requested Image SSE protocol with native completion/error events.
  if (request.stream && response.ok && !(response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const result = convertNativeImageResponse(await response.text(), { ...request, response_format: 'b64_json' })
    const body = object(result.body)!
    const entries = Array.isArray(body.data) ? body.data : []
    const events: Record<string, unknown>[] = entries.map((entry, index) => ({ ...object(entry), type: `${prefix(request)}.completed`, model: request.model,
        created_at: body.created, output_format: body.output_format, image_index: index,
        ...(result.status !== 'error' && index === entries.length - 1 ? { usage: body.usage } : {}) }))
    if (result.status === 'error') events.push({ type: 'error', error: body.error, usage: body.usage })
    const headers = new Headers(response.headers)
    headers.set('content-type', 'text/event-stream'); headers.delete('content-length'); headers.delete('content-encoding')
    return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { status: response.status, headers })
  }
  return response
}

interface NativeFailure { code: string; message: string; type: string; status: number }
function failureFrom(value: Record<string, unknown>): NativeFailure | null {
  const error = object(value.error) ?? (value.type === 'error' ? value : null)
  if (!error) return null
  const code = text(error.code) || text(error.type) || 'image_generation_failed'
  const type = text(error.type) || 'upstream_error'
  const marker = `${code} ${type}`.toLowerCase()
  const status = /policy|moderation|safety|invalid_request/.test(marker) ? 400 : /rate_limit|quota/.test(marker) ? 429
    : /auth|api_key/.test(marker) ? 401 : /permission|forbidden/.test(marker) ? 403 : /not_found/.test(marker) ? 404 : 502
  return { code, type, status, message: text(error.message) || 'Native image generation failed.' }
}
const incomplete = (): NativeFailure => ({ code: 'image_generation_no_output', type: 'upstream_error', status: 502,
  message: 'Image stream ended without a final image.' })
function dataUrl(row: Record<string, unknown>, request: OpenAIImagesRequestBody): string {
  const format = text(row.output_format) || text(request.output_format) || 'png'
  const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png'
  return `data:${mime};base64,${text(row.b64_json)}`
}
function imageKey(row: Record<string, unknown>): string {
  return text(row.id) || (typeof row.image_index === 'number' ? `index:${row.image_index}` : createHash('sha256').update(text(row.b64_json)).digest('hex'))
}

export function createNativeImagesUsageParser(request: OpenAIImagesRequestBody) {
  let usage = emptyUsage()
  let failure: NativeFailure | null = null
  const finals = new Set<string>()
  let size = text(request.size)
  return {
    feed(raw: unknown): void {
      const row = object(raw)
      if (!row) return
      if (object(row.usage)) usage = parseNativeImageUsage(row.usage)
      failure ??= failureFrom(row)
      if (text(row.type) === `${prefix(request)}.completed` && text(row.b64_json)) finals.add(imageKey(row))
      if (text(row.size)) size = text(row.size)
    },
    result: (): UsageData => ({ ...usage, imageCount: finals.size, imageSize: size || undefined, imageModel: request.model }),
    failure: () => failure ?? (finals.size ? null : incomplete()),
  }
}

export function createNativeImagesStreamTransform(request: OpenAIImagesRequestBody) {
  let failed = false
  const emitted = new Set<string>()
  const event = (name: string, data: unknown): NamedSseEvent => ({ __modelBridgeSseEvent: true, event: name, data })
  return {
    transform(raw: unknown): unknown[] {
      if (failed) return []
      const row = object(raw)
      if (!row) return []
      const failure = failureFrom(row)
      if (failure) { failed = true; return [event('error', { ...row, type: 'error', error: failure })] }
      const type = text(row.type)
      if (![`${prefix(request)}.partial_image`, `${prefix(request)}.completed`].includes(type) || !text(row.b64_json)) return []
      if (type.endsWith('.completed')) {
        const key = imageKey(row)
        if (emitted.has(key)) return []
        emitted.add(key)
      }
      return [event(type, { ...row, ...(request.response_format === 'url' ? { url: dataUrl(row, request) } : {}) })]
    },
    flush(): unknown[] {
      if (failed || emitted.size) return []
      failed = true
      return [event('error', { type: 'error', error: incomplete() })]
    },
    status: (): 'success' | 'error' => failed || !emitted.size ? 'error' : 'success',
  }
}

export function convertNativeImageResponse(textBody: string, request: OpenAIImagesRequestBody): BufferedImageConversion {
  let root: Record<string, unknown> | null = null
  const events: Record<string, unknown>[] = []
  try { root = object(JSON.parse(textBody)) } catch { /* Streaming transcript is parsed below. */ }
  if (root) {
    const entries = Array.isArray(root.data) ? root.data.map(object).filter((row): row is Record<string, unknown> => !!row && !!text(row.b64_json)) : []
    const usage = { ...parseNativeImageUsage(root.usage), imageCount: entries.length, imageModel: request.model, imageSize: text(root.size) || text(request.size) || undefined }
    const failure = failureFrom(root) ?? (entries.length ? null : incomplete())
    if (failure) return { body: { ...root, error: failure }, usage, status: 'error', httpStatus: failure.status,
      failureSource: root.error ? 'upstream' : 'missing_output' }
    return { body: { ...root, data: entries.map(row => {
      if (request.response_format !== 'url') return row
      const { b64_json: _image, ...rest } = row
      return { ...rest, url: dataUrl({ ...root, ...row }, request) }
    }) }, usage }
  }
  for (const block of textBody.replace(/\r\n/g, '\n').split('\n\n')) {
    const payload = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
    if (!payload || payload === '[DONE]') continue
    try { const row = object(JSON.parse(payload)); if (row) events.push(row) } catch { /* A missing final image still fails below. */ }
  }
  const parser = createNativeImagesUsageParser(request)
  const images = new Map<string, Record<string, unknown>>()
  let last: Record<string, unknown> = {}
  for (const row of events) {
    parser.feed(row)
    if (row.usage) last.usage = row.usage
    if (row.type !== `${prefix(request)}.completed` || !text(row.b64_json)) continue
    last = { ...last, ...row }
    images.set(imageKey(row), request.response_format === 'url'
      ? { url: dataUrl(row, request) } : { b64_json: row.b64_json })
  }
  const failure = parser.failure()
  const body = { created: last.created_at ?? Math.floor(Date.now() / 1000), data: [...images.values()],
    model: request.model, output_format: last.output_format, size: last.size, quality: last.quality, background: last.background, usage: last.usage }
  return { body: failure ? { ...body, error: failure } : body, usage: parser.result(),
    ...(failure ? { status: 'error' as const, httpStatus: failure.status, failureSource: failure.code === 'image_generation_no_output' ? 'missing_output' as const : 'upstream' as const } : {}) }
}
