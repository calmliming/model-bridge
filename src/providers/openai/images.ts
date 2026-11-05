import { createHash } from 'node:crypto'

import { parseOpenAIUsagePayload } from './usage'
import { relayOpenaiImageResponses } from './relay'
import { emptyUsage, type UsageData } from '../types'
import { isImage26Model, isNativeImageModel } from './imageModels'
import { relayNativeImages } from './directImages'

export type OpenAIImagesEndpoint = 'generations' | 'edits'

export interface OpenAIImageReference {
  image_url?: string
  file_id?: string
}

export interface OpenAIImagesRequestBody extends Record<string, unknown> {
  model: string
  prompt: string
  stream: boolean
  n: number
  response_format: string
  images: OpenAIImageReference[]
  mask?: OpenAIImageReference
  markup?: OpenAIImageReference
  __image_endpoint: OpenAIImagesEndpoint
}

export interface NamedSseEvent {
  __modelBridgeSseEvent: true
  event: string
  data: unknown
}

interface ImageResult {
  id?: string
  result: string
  revisedPrompt?: string
  outputFormat?: string
  size?: string
  background?: string
  quality?: string
  model?: string
}

interface ImageMeta {
  outputFormat?: string
  size?: string
  background?: string
  quality?: string
  model?: string
}

interface ImageUpstreamError {
  status: number
  type: string
  code?: string
  message: string
  param?: string
}

export type OpenAIImageFailureSource = 'upstream' | 'model_text' | 'missing_output'

export interface BufferedImageConversion {
  body: unknown
  usage: UsageData
  status?: 'error'
  httpStatus?: number
  /** Where a converted failure came from, used by account failover policy. */
  failureSource?: OpenAIImageFailureSource
}

const DEFAULT_IMAGE_MODEL = 'gpt-image-2'
// Host model for the image_generation tool. gpt-5.4-mini left ChatGPT-signed-in
// Codex on 2026-08-31; OpenAI names gpt-6-luna as its replacement.
const IMAGE_RESPONSES_MODEL = 'gpt-6-luna'
const MAX_UPLOAD_PART_BYTES = 50 * 1024 * 1024

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalInteger(value: unknown, field: string, min: number, max: number): number | undefined {
  if (value == null || value === '') return undefined
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}`)
  }
  return parsed
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value == null || value === '') return undefined
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true
    if (value.toLowerCase() === 'false') return false
  }
  throw new Error(`${field} must be a boolean`)
}

function contentDispositionParam(header: string, name: string): string {
  const match = header.match(new RegExp(`(?:^|;)\\s*${name}="([^"]*)"`, 'i'))
  return match?.[1] ?? ''
}

function parseMultipartBody(body: Buffer, contentType: string): Record<string, unknown> {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)
  const boundary = (boundaryMatch?.[1] ?? boundaryMatch?.[2] ?? '').trim()
  if (!boundary) throw new Error('multipart boundary is required')

  const marker = Buffer.from(`--${boundary}`)
  const nextMarker = Buffer.from(`\r\n--${boundary}`)
  const headerSeparator = Buffer.from('\r\n\r\n')
  const fields: Record<string, unknown> = {}
  const imageRefs: OpenAIImageReference[] = []
  let cursor = body.indexOf(marker)

  while (cursor >= 0) {
    cursor += marker.length
    if (body.subarray(cursor, cursor + 2).toString() === '--') break
    if (body.subarray(cursor, cursor + 2).toString() === '\r\n') cursor += 2

    const headerEnd = body.indexOf(headerSeparator, cursor)
    if (headerEnd < 0) throw new Error('invalid multipart body')
    const headersText = body.subarray(cursor, headerEnd).toString('utf8')
    const headers = new Map<string, string>()
    for (const line of headersText.split('\r\n')) {
      const colon = line.indexOf(':')
      if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim())
    }

    const disposition = headers.get('content-disposition') ?? ''
    const fieldName = contentDispositionParam(disposition, 'name')
    const fileName = contentDispositionParam(disposition, 'filename')
    const dataStart = headerEnd + headerSeparator.length
    const dataEnd = body.indexOf(nextMarker, dataStart)
    if (dataEnd < 0) throw new Error('invalid multipart closing boundary')
    const data = body.subarray(dataStart, dataEnd)

    if (fileName) {
      if (data.byteLength > MAX_UPLOAD_PART_BYTES) {
        throw new Error(`multipart field ${fieldName || fileName} exceeds 50 MB`)
      }
      const detected = headers.get('content-type') || 'application/octet-stream'
      const ref = { image_url: `data:${detected};base64,${data.toString('base64')}` }
      if (fieldName === 'mask' || fieldName === 'markup') fields[fieldName] = ref
      else if (fieldName === 'image' || fieldName.startsWith('image[')) imageRefs.push(ref)
    } else if (fieldName) {
      const value = data.toString('utf8').trim()
      if (fieldName === 'image' || fieldName.startsWith('image[')) {
        if (value) imageRefs.push({ image_url: value })
      } else {
        fields[fieldName] = value
      }
    }
    cursor = dataEnd + 2
  }

  if (imageRefs.length > 0) fields.images = imageRefs
  return fields
}

function imageReference(value: unknown): OpenAIImageReference | null {
  if (typeof value === 'string' && value.trim()) return { image_url: value.trim() }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const imageUrl = stringField(row.image_url)
  if (imageUrl) return { image_url: imageUrl }
  const fileId = stringField(row.file_id)
  if (fileId) return { file_id: fileId }
  return null
}

function collectImageReferences(value: unknown): OpenAIImageReference[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value]
  return values.map(imageReference).filter((item): item is OpenAIImageReference => item != null)
}

export function validateOpenAIImageModel(model: string): void {
  if (!/^gpt-image-/i.test(model)) {
    throw new Error(`images endpoint requires a GPT Image model, got ${JSON.stringify(model)}`)
  }
}

function validateGptImage2Size(size: string): void {
  if (!size || size === 'auto') return
  const match = size.match(/^(\d+)x(\d+)$/i)
  if (!match) throw new Error('size must be auto or WIDTHxHEIGHT')
  const width = Number(match[1])
  const height = Number(match[2])
  const long = Math.max(width, height)
  const short = Math.min(width, height)
  const pixels = width * height
  if (
    long > 3840 ||
    width % 16 !== 0 ||
    height % 16 !== 0 ||
    long / short > 3 ||
    pixels < 655_360 ||
    pixels > 8_294_400
  ) {
    throw new Error('size does not satisfy gpt-image-2 dimension constraints')
  }
}

export function parseOpenAIImagesRequest(
  rawBody: unknown,
  contentType: string,
  endpoint: OpenAIImagesEndpoint,
  options: { deferModelValidation?: boolean } = {},
): OpenAIImagesRequestBody {
  const source = Buffer.isBuffer(rawBody)
    ? parseMultipartBody(rawBody, contentType)
    : rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)
      ? { ...(rawBody as Record<string, unknown>) }
      : null
  if (!source) throw new Error('request body must be a JSON object or multipart form')

  const model = stringField(source.model) || DEFAULT_IMAGE_MODEL
  const prompt = typeof source.prompt === 'string' ? source.prompt : ''
  if (!prompt.trim()) throw new Error('prompt is required')
  if (!options.deferModelValidation) validateOpenAIImageModel(model)

  const n = optionalInteger(source.n, 'n', 1, 10) ?? 1
  const stream = optionalBoolean(source.stream, 'stream') ?? false
  const responseFormat = stringField(source.response_format).toLowerCase() || 'b64_json'
  if (!['b64_json', 'url'].includes(responseFormat)) {
    throw new Error('response_format must be b64_json or url')
  }

  const images = collectImageReferences(source.images ?? source.image)
  const rawImages = source.images ?? source.image
  if (rawImages != null && (Array.isArray(rawImages) ? rawImages.length : 1) !== images.length) throw new Error('invalid image reference')
  if (endpoint === 'edits' && images.length === 0) throw new Error('image input is required')

  const normalized: OpenAIImagesRequestBody = {
    ...source,
    model,
    prompt,
    stream,
    n,
    response_format: responseFormat,
    images,
    __image_endpoint: endpoint,
  }
  const mask = imageReference(source.mask)
  if (source.mask != null && !mask) throw new Error('invalid mask reference')
  if (mask?.file_id) throw new Error('mask.file_id is not supported; use mask.image_url instead')
  if (mask) normalized.mask = mask
  if (source.markup != null) {
    const row = source.markup as Record<string, unknown>
    const markup = imageReference(row)
    if (!markup || typeof row !== 'object' || Array.isArray(row) || !!stringField(row.image_url) === !!stringField(row.file_id)) {
      throw new Error('markup requires exactly one image_url or file_id')
    }
    normalized.markup = markup
  }
  for (const numericField of ['output_compression', 'partial_images'] as const) {
    const value = optionalInteger(source[numericField], numericField, 0, numericField === 'output_compression' ? 100 : 3)
    if (value != null) normalized[numericField] = value
    else delete normalized[numericField]
  }
  // The API reference currently permits 2–16 GIF frames; keep the gateway
  // within that contract even though the guide advertises a wider preview.
  for (const [field, min, max] of [['frame_count', 2, 16], ['frame_duration_ms', 20, 2000]] as const) {
    const value = optionalInteger(source[field], field, min, max)
    if (value != null) normalized[field] = value
    else delete normalized[field]
  }
  if (!options.deferModelValidation) validateOpenAIImagesRequestModel(normalized, model, endpoint)
  return normalized
}

export function validateOpenAIImagesRequestModel(
  body: Record<string, unknown>,
  model: string,
  endpoint: OpenAIImagesEndpoint = body.__image_endpoint === 'edits' ? 'edits' : 'generations',
): void {
  validateOpenAIImageModel(model)
  if (/^gpt-image-2\.[56]/i.test(model)) {
    if (!isNativeImageModel(model)) throw new Error('unsupported Image 2.5/2.6 model; use Flare or Sunburst')
    const image26 = isImage26Model(model)
    if (body.size != null && typeof body.size !== 'string') throw new Error('size must be a string')
    const format = stringField(body.output_format) || 'png'
    if (image26 && format === 'gif') {
      const size = stringField(body.size)
      if (size && size !== 'auto') {
        const match = /^(\d+)x(\d+)$/i.exec(size)
        const width = Number(match?.[1]), height = Number(match?.[2])
        if (!width || !height || width % 16 || height % 16 || Math.max(width, height) > 3840 || width * height > 8_294_400) {
          throw new Error('GIF size must contain positive multiples of 16 within the image size limits')
        }
      }
    } else validateGptImage2Size(stringField(body.size))
    for (const [field, allowed] of Object.entries({
      quality: ['low', 'medium', 'high', 'xhigh', 'max', 'auto'],
      background: ['transparent', 'opaque', 'auto'], output_format: image26 ? ['png', 'jpeg', 'webp', 'svg', 'gif'] : ['png', 'jpeg', 'webp'],
    })) {
      if (body[field] != null && !allowed.includes(stringField(body[field]))) throw new Error(`invalid GPT Image ${field}`)
    }
    if (body.complexity != null && (!image26 || !['low', 'medium', 'high'].includes(stringField(body.complexity)))) throw new Error('complexity requires Image 2.6 and must be low, medium or high')
    if (body.background === 'transparent' && !['png', 'webp'].includes(format)) throw new Error('transparent backgrounds require png or webp')
    if (collectImageReferences(body.images ?? body.image).some(image => image.file_id)) throw new Error('native images require image_url instead of file_id')
    if (collectImageReferences(body.images ?? body.image).length > 16) throw new Error('native edits accept at most 16 images')
    if (body.markup != null) {
      if (endpoint !== 'edits') throw new Error('markup is only supported on image edits')
      const markup = body.markup as OpenAIImageReference
      if (!markup.image_url || markup.file_id) throw new Error('native markup requires image_url instead of file_id')
      if (!/^https:\/\//i.test(markup.image_url) && !/^data:image\/png;base64,/i.test(markup.image_url)) throw new Error('markup must be an HTTPS URL or PNG data URL')
      if (body.mask != null || body.prompt_rewriter != null) throw new Error('markup cannot be combined with mask or prompt_rewriter')
    }
    if (body.frame_count != null || body.frame_duration_ms != null) {
      if (!image26 || format !== 'gif') throw new Error('frame_count and frame_duration_ms require Image 2.6 GIF output')
    }
    if (format === 'svg' || format === 'gif') {
      if (endpoint !== 'generations') throw new Error('SVG and GIF output are only supported on image generations')
      if (body.stream === true || Number(body.partial_images ?? 0) > 0 || body.output_compression != null || body.prompt_rewriter != null || body.mask != null) {
        throw new Error('SVG and GIF output do not support streaming, partial images, compression, masks or prompt_rewriter')
      }
      if (format === 'svg' && Number(body.n ?? 1) !== 1) throw new Error('SVG output requires n=1')
    }
    if (body.svg != null) {
      if (format !== 'svg' || typeof body.svg !== 'object' || Array.isArray(body.svg)) throw new Error('svg options require SVG output')
      const svg = body.svg as Record<string, unknown>
      if (!stringField(svg.model) || stringField(svg.model).length > 200 || Object.keys(svg).some(key => !['model', 'reasoning'].includes(key))) throw new Error('svg.model is required and svg options must contain only model and reasoning')
      if (svg.reasoning != null) {
        const reasoning = svg.reasoning as Record<string, unknown>
        if (typeof reasoning !== 'object' || Array.isArray(reasoning) || Object.keys(reasoning).some(key => key !== 'effort') ||
          (reasoning.effort != null && !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(stringField(reasoning.effort)))) throw new Error('invalid SVG reasoning effort')
      }
    }
    if (body.safety_identifier != null && (typeof body.safety_identifier !== 'string' || body.safety_identifier.length > 128)) throw new Error('safety_identifier must be a string of at most 128 characters')
    return
  }
  if (!model.toLowerCase().startsWith('gpt-image-2')) return
  validateGptImage2Size(stringField(body.size))
  if (stringField(body.background) === 'transparent') {
    throw new Error('gpt-image-2 does not support transparent backgrounds')
  }
}

function inputImagePart(ref: OpenAIImageReference): Record<string, unknown> {
  if (ref.file_id) return { type: 'input_image', file_id: ref.file_id }
  return { type: 'input_image', image_url: ref.image_url }
}

export function buildOpenAIImagesResponsesRequest(body: OpenAIImagesRequestBody): Record<string, unknown> {
  const action = body.__image_endpoint === 'edits' ? 'edit' : 'generate'
  const tool: Record<string, unknown> = {
    type: 'image_generation',
    action,
    model: body.model,
  }
  if (body.n > 1) tool.n = body.n
  for (const field of ['size', 'quality', 'background', 'output_format', 'moderation', 'style'] as const) {
    const value = stringField(body[field])
    if (value) tool[field] = value
  }
  for (const field of ['output_compression', 'partial_images'] as const) {
    if (typeof body[field] === 'number') tool[field] = body[field]
  }
  if (body.mask?.image_url) tool.input_image_mask = { image_url: body.mask.image_url }

  return {
    model: IMAGE_RESPONSES_MODEL,
    instructions: '',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: body.prompt },
          ...body.images.map(inputImagePart),
        ],
      },
    ],
    tools: [tool],
    tool_choice: { type: 'image_generation' },
    stream: true,
    store: false,
  }
}

export function relayOpenaiImages(
  accessToken: string,
  body: Record<string, unknown>,
  accountId?: string,
): Promise<Response> {
  if (isNativeImageModel(String(body.model))) return relayNativeImages(accessToken, body as OpenAIImagesRequestBody, accountId)
  return relayOpenaiImageResponses(
    accessToken,
    buildOpenAIImagesResponsesRequest(body as OpenAIImagesRequestBody),
  )
}

function parseSsePayloads(text: string): unknown[] {
  const events: unknown[] = []
  let dataLines: string[] = []
  const flush = () => {
    const payload = dataLines.join('\n').trim()
    dataLines = []
    if (!payload || payload === '[DONE]') return
    try {
      events.push(JSON.parse(payload))
    } catch {
      // Ignore malformed upstream diagnostic frames.
    }
  }
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (line === '') {
      flush()
      continue
    }
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
  }
  flush()
  return events
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function mergeMeta(target: ImageMeta, source: ImageMeta): void {
  for (const key of ['outputFormat', 'size', 'background', 'quality', 'model'] as const) {
    if (source[key]) target[key] = source[key]
  }
}

function metaFromResponse(response: Record<string, unknown>): ImageMeta {
  const tool = recordOf(arrayOf(response.tools)[0])
  return {
    outputFormat: stringField(tool?.output_format),
    size: stringField(tool?.size),
    background: stringField(tool?.background),
    quality: stringField(tool?.quality),
    model: stringField(tool?.model),
  }
}

function imageResultFromItem(value: unknown, meta: ImageMeta): ImageResult | null {
  const item = recordOf(value)
  if (!item || item.type !== 'image_generation_call') return null
  const result = stringField(item.result)
  if (!result) return null
  return {
    id: stringField(item.id) || stringField(item.call_id) || undefined,
    result,
    revisedPrompt: stringField(item.revised_prompt) || undefined,
    outputFormat: stringField(item.output_format) || meta.outputFormat,
    size: stringField(item.size) || meta.size,
    background: stringField(item.background) || meta.background,
    quality: stringField(item.quality) || meta.quality,
    model: stringField(item.model) || meta.model,
  }
}

function resultKey(result: ImageResult): string {
  return result.id || createHash('sha256').update(result.result).digest('hex')
}

function upstreamErrorFromEvent(event: Record<string, unknown>): ImageUpstreamError | null {
  const type = stringField(event.type)
  let error: Record<string, unknown> | null = null
  if (type === 'error') error = recordOf(event.error)
  if (type === 'response.failed') error = recordOf(recordOf(event.response)?.error)
  if (type === 'response.incomplete') {
    return {
      status: 502,
      type: 'upstream_error',
      code: 'image_generation_incomplete',
      message: 'Image generation did not complete.',
    }
  }
  if (!error) return null
  const errorType = stringField(error.type) || 'upstream_error'
  const code = stringField(error.code) || undefined
  const marker = `${errorType} ${code ?? ''}`.toLowerCase()
  const status = marker.includes('rate_limit')
    ? 429
    : marker.includes('authentication') || marker.includes('invalid_api_key')
      ? 401
      : marker.includes('permission') || marker.includes('forbidden')
        ? 403
        : marker.includes('not_found')
          ? 404
          : marker.includes('invalid_request') || marker.includes('image_generation_user_error') || marker.includes('policy') || marker.includes('moderation')
            ? 400
            : 502
  return {
    status,
    type: errorType,
    code,
    message: stringField(error.message) || 'Upstream image generation failed.',
    param: stringField(error.param) || undefined,
  }
}

function errorBody(error: ImageUpstreamError): { error: Record<string, unknown> } {
  return {
    error: {
      type: error.type,
      ...(error.code ? { code: error.code } : {}),
      message: error.message,
      ...(error.param ? { param: error.param } : {}),
    },
  }
}

function looksLikeImagePolicyRefusal(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return false
  return [
    'content policy',
    'policy violation',
    'safety policy',
    'content moderation',
    'moderation policy',
    'blocked by policy',
  ].some((marker) => normalized.includes(marker))
}

function toolUsage(response: Record<string, unknown>): Record<string, unknown> | null {
  return recordOf(recordOf(response.tool_usage)?.image_gen)
}

function imageUsage(
  response: Record<string, unknown>,
  count: number,
  size: string | undefined,
  model: string,
): UsageData {
  const tool = toolUsage(response)
  const tokenSource = tool && (tool.input_tokens != null || tool.output_tokens != null)
    ? tool
    : recordOf(response.usage)
  const usage = tokenSource ? parseOpenAIUsagePayload(tokenSource) : emptyUsage()
  // Per-image charges follow actual final outputs; reported token usage remains
  // billable independently even when the upstream supplies no image result.
  usage.imageCount = count
  usage.imageSize = size
  usage.imageModel = model
  return usage
}

function mimeType(format: string | undefined): string {
  if (format?.includes('/')) return format
  if (format === 'jpeg' || format === 'jpg') return 'image/jpeg'
  if (format === 'webp') return 'image/webp'
  return 'image/png'
}

function resultData(result: ImageResult, responseFormat: string): Record<string, unknown> {
  const out: Record<string, unknown> = responseFormat === 'url'
    ? { url: `data:${mimeType(result.outputFormat)};base64,${result.result}` }
    : { b64_json: result.result }
  if (result.revisedPrompt) out.revised_prompt = result.revisedPrompt
  return out
}

function responseMetadata(meta: ImageMeta, fallbackModel: string): Record<string, unknown> {
  return {
    ...(meta.background ? { background: meta.background } : {}),
    ...(meta.outputFormat ? { output_format: meta.outputFormat } : {}),
    ...(meta.quality ? { quality: meta.quality } : {}),
    ...(meta.size ? { size: meta.size } : {}),
    model: meta.model || fallbackModel,
  }
}

export function convertOpenAIImagesSse(
  text: string,
  request: OpenAIImagesRequestBody,
): BufferedImageConversion {
  const results = new Map<string, ImageResult>()
  const meta: ImageMeta = { model: request.model }
  let completedResponse: Record<string, unknown> | null = null
  let upstreamError: ImageUpstreamError | null = null
  const refusals: string[] = []

  for (const raw of parseSsePayloads(text)) {
    const event = recordOf(raw)
    if (!event) continue
    upstreamError ??= upstreamErrorFromEvent(event)
    const type = stringField(event.type)
    const response = recordOf(event.response)
    if (response) mergeMeta(meta, metaFromResponse(response))
    if (type === 'response.output_text.delta') {
      const delta = stringField(event.delta)
      if (delta) refusals.push(delta)
    }
    if (type === 'response.output_item.done') {
      const result = imageResultFromItem(event.item, meta)
      if (result) results.set(resultKey(result), result)
    }
    if (type === 'response.completed' && response) {
      completedResponse = response
      for (const item of arrayOf(response.output)) {
        const result = imageResultFromItem(item, meta)
        if (result) results.set(resultKey(result), result)
        const message = recordOf(item)
        if (message?.type === 'message') {
          for (const part of arrayOf(message.content)) {
            const row = recordOf(part)
            if (row?.type === 'output_text' && stringField(row.text)) refusals.push(stringField(row.text))
          }
        }
      }
    }
  }

  if (upstreamError) {
    return {
      body: errorBody(upstreamError),
      usage: emptyUsage(),
      status: 'error',
      httpStatus: upstreamError.status,
      failureSource: 'upstream',
    }
  }
  if (!completedResponse || results.size === 0) {
    const refusal = refusals.join(' ').trim()
    const policyRefusal = looksLikeImagePolicyRefusal(refusal)
    const error: ImageUpstreamError = policyRefusal
      ? { status: 400, type: 'image_generation_user_error', code: 'content_policy_violation', message: refusal }
      : refusal
        ? {
            status: 502,
            type: 'upstream_error',
            code: 'image_generation_unavailable',
            message: refusal,
          }
        : {
            status: 502,
            type: 'upstream_error',
            code: 'image_generation_no_output',
            message: 'Upstream did not return image output.',
          }
    return {
      body: errorBody(error),
      usage: emptyUsage(),
      status: 'error',
      httpStatus: error.status,
      failureSource: refusal ? 'model_text' : 'missing_output',
    }
  }

  const entries = [...results.values()]
  const first = entries[0]!
  mergeMeta(meta, {
    outputFormat: first.outputFormat,
    size: first.size,
    background: first.background,
    quality: first.quality,
    model: first.model,
  })
  const usage = imageUsage(completedResponse, entries.length, meta.size, meta.model || request.model)
  return {
    body: {
      created: typeof completedResponse.created_at === 'number' ? completedResponse.created_at : Math.floor(Date.now() / 1000),
      data: entries.map((entry) => resultData(entry, request.response_format)),
      ...responseMetadata(meta, request.model),
      ...(toolUsage(completedResponse) ? { usage: toolUsage(completedResponse) } : {}),
    },
    usage,
  }
}

function namedEvent(event: string, data: unknown): NamedSseEvent {
  return { __modelBridgeSseEvent: true, event, data }
}

function streamPrefix(request: OpenAIImagesRequestBody): string {
  return request.__image_endpoint === 'edits' ? 'image_edit' : 'image_generation'
}

function streamPayload(
  eventType: string,
  result: ImageResult,
  request: OpenAIImagesRequestBody,
  createdAt: number,
  usage?: unknown,
): Record<string, unknown> {
  return {
    type: eventType,
    created_at: createdAt || Math.floor(Date.now() / 1000),
    b64_json: result.result,
    ...(request.response_format === 'url'
      ? { url: `data:${mimeType(result.outputFormat)};base64,${result.result}` }
      : {}),
    ...(result.outputFormat ? { output_format: result.outputFormat } : {}),
    ...(result.background ? { background: result.background } : {}),
    ...(result.quality ? { quality: result.quality } : {}),
    ...(result.size ? { size: result.size } : {}),
    model: result.model || request.model,
    ...(usage ? { usage } : {}),
  }
}

export function createOpenAIImagesStreamTransform(request: OpenAIImagesRequestBody) {
  const prefix = streamPrefix(request)
  const meta: ImageMeta = { model: request.model }
  const pending = new Map<string, ImageResult>()
  const emitted = new Set<string>()
  let createdAt = 0
  let failed = false

  return {
    transform(raw: unknown): unknown[] {
      const event = recordOf(raw)
      if (!event) return []
      const upstreamError = upstreamErrorFromEvent(event)
      if (upstreamError) {
        failed = true
        return [namedEvent('error', { type: 'error', ...errorBody(upstreamError) })]
      }

      const type = stringField(event.type)
      const response = recordOf(event.response)
      if (response) {
        mergeMeta(meta, metaFromResponse(response))
        if (typeof response.created_at === 'number') createdAt = response.created_at
      }
      if (type === 'response.image_generation_call.partial_image') {
        const b64 = stringField(event.partial_image_b64)
        if (!b64) return []
        const result: ImageResult = {
          result: b64,
          outputFormat: stringField(event.output_format) || meta.outputFormat,
          background: stringField(event.background) || meta.background,
          quality: meta.quality,
          size: meta.size,
          model: meta.model,
        }
        const payload = streamPayload(`${prefix}.partial_image`, result, request, createdAt)
        payload.partial_image_index = typeof event.partial_image_index === 'number' ? event.partial_image_index : 0
        return [namedEvent(`${prefix}.partial_image`, payload)]
      }
      if (type === 'response.output_item.done') {
        const result = imageResultFromItem(event.item, meta)
        if (result) pending.set(resultKey(result), result)
        return []
      }
      if (type !== 'response.completed' || !response) return []

      for (const item of arrayOf(response.output)) {
        const result = imageResultFromItem(item, meta)
        if (result) pending.set(resultKey(result), result)
      }
      const usage = toolUsage(response) ?? undefined
      const output: NamedSseEvent[] = []
      for (const [key, result] of pending) {
        if (emitted.has(key)) continue
        emitted.add(key)
        output.push(namedEvent(
          `${prefix}.completed`,
          streamPayload(`${prefix}.completed`, result, request, createdAt, usage),
        ))
      }
      if (output.length === 0) {
        failed = true
        const error: ImageUpstreamError = {
          status: 502,
          type: 'upstream_error',
          code: 'image_generation_no_output',
          message: 'Upstream did not return image output.',
        }
        output.push(namedEvent('error', { type: 'error', ...errorBody(error) }))
      }
      return output
    },
    flush(): unknown[] {
      return []
    },
    status(): 'success' | 'error' {
      return failed ? 'error' : 'success'
    },
  }
}

export function createOpenAIImagesUsageParser(request: OpenAIImagesRequestBody) {
  let usage = emptyUsage()
  const seen = new Set<string>()
  let size = stringField(request.size) || undefined
  let model = request.model
  return {
    feed(raw: unknown): void {
      const event = recordOf(raw)
      if (!event) return
      const response = recordOf(event.response)
      if (response) {
        const meta = metaFromResponse(response)
        size = meta.size || size
        model = meta.model || model
      }
      if (event.type === 'response.output_item.done') {
        const result = imageResultFromItem(event.item, { size, model })
        if (result) seen.add(resultKey(result))
      }
      if (event.type === 'response.completed' && response) {
        for (const item of arrayOf(response.output)) {
          const result = imageResultFromItem(item, { size, model })
          if (result) seen.add(resultKey(result))
        }
        usage = imageUsage(response, seen.size, size, model)
      }
    },
    result(): UsageData {
      return { ...usage, imageCount: usage.imageCount ?? seen.size, imageSize: usage.imageSize ?? size, imageModel: usage.imageModel ?? model }
    },
  }
}

export function summarizeOpenAIImagesRequest(body: Record<string, unknown>): string {
  const request = body as OpenAIImagesRequestBody
  return JSON.stringify({
    endpoint: request.__image_endpoint,
    model: request.model,
    prompt: request.prompt,
    n: request.n,
    stream: request.stream,
    size: request.size ?? null,
    quality: request.quality ?? null,
    complexity: request.complexity ?? null,
    output_format: request.output_format ?? null,
    frame_count: request.frame_count ?? null,
    frame_duration_ms: request.frame_duration_ms ?? null,
    image_inputs: request.images.length,
    has_mask: !!request.mask,
    has_markup: !!request.markup,
  })
}
