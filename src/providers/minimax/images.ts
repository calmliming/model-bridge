import { upstreamSignal } from '../../http/cancellation'
import { fetchWithConnectTimeout } from '../../http/upstream'
import { redactUpstreamError } from '../../http/upstreamDiagnostics'
import { UnsafeUpstreamUrlError } from '../../http/urlGuard'
import type { NamedSseEvent, OpenAIImagesRequestBody } from '../openai/images'
import { ProviderRequestError } from '../requestError'
import { emptyUsage, type UsageData } from '../types'
import { minimaxBaseUrl } from './relay'

export const MINIMAX_IMAGE_MODEL = 'MiniMax-H3-Image'
export const MINIMAX_IMAGE_HIGHSPEED_MODEL = 'MiniMax-H3-Image-Highspeed'
export const MINIMAX_IMAGE_MODELS = [MINIMAX_IMAGE_MODEL, MINIMAX_IMAGE_HIGHSPEED_MODEL] as const

const MAX_PROMPT_CHARS = 32_000
const MAX_PIXELS = 20_000_000
const MAX_EDIT_REFERENCES = 16
const ALLOWED_FORMATS = new Set(['jpeg', 'jpg', 'png', 'webp'])
const ALLOWED_AREAS = new Set(['1K', '2K', '4K'])
const UNSUPPORTED_FIELDS = [
  'quality', 'background', 'mask', 'markup', 'partial_images', 'output_compression',
  'moderation', 'input_fidelity', 'style', 'complexity', 'frame_count', 'frame_duration_ms',
  'prompt_rewriter', 'svg',
] as const

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0
}

function invalid(message: string, code = 'invalid_image_request'): never {
  throw new ProviderRequestError(code, message)
}

/** Matches MiniMax H3-Image and its Highspeed variant case-insensitively. */
export function isMiniMaxImageModel(model: unknown): boolean {
  return typeof model === 'string' && /^minimax-h3-image(?:-highspeed)?$/i.test(model.trim())
}

/** Normalizes MiniMax image IDs to the exact casing expected by the upstream API. */
export function canonicalMiniMaxImageModel(model: string): string {
  return model.trim().toLowerCase().endsWith('-highspeed')
    ? MINIMAX_IMAGE_HIGHSPEED_MODEL
    : MINIMAX_IMAGE_MODEL
}

function validateExplicitSize(size: string): boolean {
  if (size === 'auto') return false
  const match = /^(\d+)x(\d+)$/i.exec(size)
  if (!match) invalid('size must be auto or WIDTHxHEIGHT')
  const width = Number(match[1])
  const height = Number(match[2])
  if (!width || !height) invalid('size dimensions must be positive integers')
  const ratio = Math.max(width, height) / Math.min(width, height)
  if (ratio > 3) invalid('image aspect ratio must be between 1:3 and 3:1')
  if (width * height > MAX_PIXELS) invalid('MiniMax H3-Image size exceeds 20 megapixels')
  return true
}

function validateAspectRatio(raw: string): boolean {
  if (raw === 'auto') return false
  const match = /^(\d+):(\d+)$/.exec(raw)
  if (!match) invalid('aspect_ratio must be auto or W:H')
  const w = Number(match[1])
  const h = Number(match[2])
  if (!w || !h || w > 300 || h > 300) invalid('aspect_ratio dimensions must be integers between 1 and 300')
  if (Math.max(w, h) / Math.min(w, h) > 3) invalid('aspect_ratio must be between 1:3 and 3:1')
  return true
}

/** Validates and converts an OpenAI-style Images request to MiniMax H3-Image JSON. */
export function buildMiniMaxImageRequest(body: OpenAIImagesRequestBody): Record<string, unknown> {
  if (!isMiniMaxImageModel(body.model)) {
    invalid('unsupported MiniMax image model; use MiniMax-H3-Image or MiniMax-H3-Image-Highspeed', 'invalid_image_model')
  }
  if (body.prompt.length > MAX_PROMPT_CHARS) {
    invalid(`MiniMax H3-Image prompt must be at most ${MAX_PROMPT_CHARS} characters`)
  }
  for (const field of UNSUPPORTED_FIELDS) {
    if (body[field] != null) invalid(`MiniMax H3-Image does not support ${field}`)
  }

  if (body.__image_endpoint === 'generations') {
    if (body.images.length > 0) invalid('use /images/edits when providing reference images')
  } else {
    if (body.images.length === 0) invalid('image input is required')
    if (body.images.length > MAX_EDIT_REFERENCES) invalid(`MiniMax H3-Image edits accept at most ${MAX_EDIT_REFERENCES} images`)
    if (body.images.some(image => image.file_id || !image.image_url)) {
      invalid('MiniMax H3-Image edits require image_url or base64 data URLs instead of file_id')
    }
  }

  if (body.size != null && typeof body.size !== 'string') invalid('size must be a string')
  const size = stringValue(body.size)
  const explicitSize = size ? validateExplicitSize(size) : false

  const rawAspectRatio = body.aspect_ratio ?? body.aspectRatio
  if (rawAspectRatio != null && typeof rawAspectRatio !== 'string') invalid('aspect_ratio must be a string')
  const aspectRatio = stringValue(rawAspectRatio)
  const explicitAspectRatio = aspectRatio ? validateAspectRatio(aspectRatio) : false

  const rawArea = body.area
  if (rawArea != null && typeof rawArea !== 'string') invalid('area must be a string')
  const area = stringValue(rawArea)
  if (area && !ALLOWED_AREAS.has(area)) invalid('area must be 1K, 2K or 4K')

  if (explicitSize && (aspectRatio || area)) {
    invalid('MiniMax H3-Image cannot combine explicit WIDTHxHEIGHT size with aspect_ratio or area')
  }

  const outputFormat = stringValue(body.output_format).toLowerCase()
  if (outputFormat && !ALLOWED_FORMATS.has(outputFormat)) invalid('output_format must be jpeg, jpg, png or webp')

  const disableEnhanced = body.disable_prompt_enhanced
  if (disableEnhanced !== undefined && typeof disableEnhanced !== 'boolean') {
    invalid('disable_prompt_enhanced must be a boolean')
  }
  if (disableEnhanced === true && !explicitSize && !explicitAspectRatio) {
    invalid('MiniMax H3-Image requires explicit WIDTHxHEIGHT size or non-auto aspect_ratio when disable_prompt_enhanced is true')
  }

  if (body.stream && body.__explicit_response_format && body.response_format !== 'url') {
    invalid('MiniMax H3-Image streaming only supports response_format=url')
  }

  const payload: Record<string, unknown> = {
    model: canonicalMiniMaxImageModel(body.model),
    prompt: body.prompt,
    n: body.n,
    response_format: body.stream ? 'url' : body.response_format,
  }
  if (size) payload.size = size
  if (aspectRatio) payload.aspect_ratio = aspectRatio
  if (area) payload.area = area
  if (outputFormat) payload.output_format = outputFormat
  if (body.stream) payload.stream = true
  if (disableEnhanced !== undefined) payload.disable_prompt_enhanced = disableEnhanced
  if (body.__image_endpoint === 'edits') {
    payload.images = body.images.map(image => ({ image_url: image.image_url }))
  }
  return payload
}

/** Relays a validated MiniMax H3-Image generation or edit request upstream. */
export async function relayMiniMaxImages(
  apiKey: string,
  body: OpenAIImagesRequestBody,
  baseUrl?: string | null,
): Promise<Response> {
  const payload = buildMiniMaxImageRequest(body)
  try {
    return await fetchWithConnectTimeout(`${minimaxBaseUrl(baseUrl)}/v1/images/${body.__image_endpoint}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        accept: body.stream ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify(payload),
    }, 600_000)
  } catch (error) {
    if (error instanceof ProviderRequestError || upstreamSignal()?.aborted) throw error
    const message = error instanceof UnsafeUpstreamUrlError
      ? error.message
      : error instanceof Error
        ? redactUpstreamError(error.message)
        : 'MiniMax image generation is temporarily unavailable'
    return Response.json(
      { error: { type: 'upstream_error', code: 'image_generation_failed', message } },
      { status: error instanceof UnsafeUpstreamUrlError ? 400 : 502 },
    )
  }
}

function firstSize(data: unknown, fallback?: string): string | undefined {
  if (!Array.isArray(data)) return fallback
  for (const entry of data) {
    const size = stringValue(object(entry)?.size)
    if (size) return size
  }
  return fallback
}

function dataImageCount(data: unknown): number {
  if (!Array.isArray(data)) return 0
  return data.filter(item => {
    const row = object(item)
    return !!row && (!!stringValue(row.url) || !!stringValue(row.b64_json))
  }).length
}

/** Parses MiniMax H3-Image token and image counts from JSON responses or completed SSE frames. */
export function parseMiniMaxImageUsage(
  raw: unknown,
  fallbackModel = MINIMAX_IMAGE_MODEL,
  fallbackSize?: string,
): UsageData {
  const root = object(raw)
  const usage = object(root?.usage)
  const inDetails = object(usage?.input_tokens_details)
  const outDetails = object(usage?.output_tokens_details)

  const imageInput = count(inDetails?.image_tokens)
  const explicitTextInput = inDetails?.text_tokens !== undefined ? count(inDetails.text_tokens) : null
  const inputTotal = count(usage?.input_tokens ?? usage?.prompt_tokens)
  const textInput = explicitTextInput ?? Math.max(0, inputTotal - imageInput)
  const imageOutput = count(outDetails?.image_tokens ?? usage?.output_tokens ?? usage?.completion_tokens)
  const images = count(usage?.generated_images) || dataImageCount(root?.data)
  const hasUsage = !!usage && (textInput > 0 || imageInput > 0 || imageOutput > 0 || images > 0)

  return {
    ...emptyUsage(),
    inputTokens: textInput,
    outputTokens: 0,
    ...(imageInput ? { imageInputTokens: imageInput } : {}),
    ...(imageOutput ? { imageOutputTokens: imageOutput } : {}),
    ...(images ? { imageCount: images } : {}),
    imageModel: canonicalMiniMaxImageModel(fallbackModel),
    ...(firstSize(root?.data, fallbackSize) ? { imageSize: firstSize(root?.data, fallbackSize) } : {}),
    usageSource: hasUsage ? 'upstream' : images > 0 ? 'partial' : 'missing',
  }
}

/** True when an upstream MiniMax image payload already carries billable output or token usage. */
export function hasMiniMaxImageBillableWork(raw: unknown): boolean {
  const root = object(raw)
  if (!root) return false
  if (dataImageCount(root.data) > 0) return true
  const usage = parseMiniMaxImageUsage(root)
  return usage.inputTokens > 0 || (usage.imageInputTokens ?? 0) > 0 || (usage.imageOutputTokens ?? 0) > 0 || (usage.imageCount ?? 0) > 0
}

function errorFromObject(raw: Record<string, unknown>): { code: string; message: string } | null {
  const nested = object(raw.error)
  if (nested) {
    return {
      code: stringValue(nested.code) || stringValue(nested.type) || 'image_generation_failed',
      message: stringValue(nested.message) || 'MiniMax image generation failed.',
    }
  }
  if (stringValue(raw.type) === 'error') {
    return {
      code: stringValue(raw.code) || 'image_generation_failed',
      message: stringValue(raw.message) || 'MiniMax image generation failed.',
    }
  }
  return null
}

/** Tracks MiniMax H3-Image SSE streams and buffered JSON payloads for usage and terminal failure checks. */
export function createMiniMaxImagesStreamParser(request: OpenAIImagesRequestBody) {
  const seenImages = new Set<string>()
  let usage = emptyUsage()
  let completed = false
  let terminalError: ReturnType<typeof errorFromObject> = null
  let imageError: ReturnType<typeof errorFromObject> = null
  let size = stringValue(request.size) && request.size !== 'auto' ? stringValue(request.size) : undefined
  const model = canonicalMiniMaxImageModel(request.model)
  const prefix = request.__image_endpoint === 'edits' ? 'image_edit' : 'image_generation'

  return {
    feed(raw: unknown): void {
      const row = object(raw)
      if (!row) return
      const type = stringValue(row.type)
      if (type === 'error' || !type) terminalError ??= errorFromObject(row)
      if (type === `${prefix}.partial_succeeded` && (stringValue(row.url) || stringValue(row.b64_json))) {
        const key = typeof row.image_index === 'number' ? `index:${row.image_index}` : stringValue(row.url) || stringValue(row.b64_json)
        seenImages.add(key)
        const reportedSize = stringValue(row.size)
        if (reportedSize) size = reportedSize
      }
      if (type === `${prefix}.completed`) completed = true
      if (Array.isArray(row.data)) {
        completed = true
        row.data.forEach((entry, index) => {
          const item = object(entry)
          if (!item) return
          if (stringValue(item.url) || stringValue(item.b64_json)) {
            seenImages.add(`index:${index}`)
            const reportedSize = stringValue(item.size)
            if (reportedSize) size = reportedSize
          } else {
            imageError ??= errorFromObject(item)
          }
        })
      }
      if (object(row.usage)) usage = parseMiniMaxImageUsage(row, model, size)
    },
    result: (): UsageData => ({
      ...usage,
      imageModel: model,
      ...(size ? { imageSize: usage.imageSize ?? size } : {}),
      imageCount: Math.max(usage.imageCount ?? 0, seenImages.size),
    }),
    failure(): { code: string; message: string; closingEvent?: NamedSseEvent } | null {
      if (terminalError) return terminalError
      if (completed) {
        return seenImages.size ? null : imageError ?? { code: 'image_generation_no_output', message: 'No final image received.' }
      }
      // Partial successes carry image URLs, while the final event carries the
      // authoritative usage. Keep any observed images when the stream ends early.
      const error = seenImages.size > 0
        ? { code: 'upstream_stream_closed', message: 'MiniMax image stream closed before completion.' }
        : { code: 'image_generation_no_output', message: 'Image stream ended without a final image.' }
      return {
        ...error,
        closingEvent: {
          __modelBridgeSseEvent: true,
          event: 'error',
          data: { type: 'error', error: { type: 'upstream_error', http_code: '502', ...error } },
        },
      }
    },
  }
}
