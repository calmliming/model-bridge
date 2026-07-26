import { emptyUsage, usageWithCachedInput, type UsageData } from '../types'

interface OpenAIUsage {
  input_tokens?: number
  output_tokens?: number
  input_tokens_details?: {
    cached_tokens?: number
    cache_write_tokens?: number
    cache_creation_tokens?: number
    image_tokens?: number
  }
  output_tokens_details?: { reasoning_tokens?: number; image_tokens?: number }
  cached_tokens?: number
  cache_creation_tokens?: number
}

interface OpenAIResponsePayload {
  usage?: OpenAIUsage
  tools?: unknown[]
  output?: unknown[]
}

/**
 * Cache-write (cache-creation) tokens from a Responses usage payload. gpt-5.6
 * reports these under input_tokens_details; older models omit them (→ 0).
 */
function cacheWriteOf(u: OpenAIUsage | undefined): number | undefined {
  const d = u?.input_tokens_details
  return d?.cache_write_tokens ?? d?.cache_creation_tokens ?? u?.cache_creation_tokens
}

export function parseOpenAIUsagePayload(u: OpenAIUsage | undefined): UsageData {
  const usage = usageWithCachedInput(
    u?.input_tokens,
    u?.output_tokens,
    u?.input_tokens_details?.cached_tokens ?? u?.cached_tokens,
    u?.output_tokens_details?.reasoning_tokens,
    cacheWriteOf(u),
  )
  const imageInput = Math.min(Math.max(0, u?.input_tokens_details?.image_tokens ?? 0), usage.inputTokens)
  const imageOutput = Math.min(Math.max(0, u?.output_tokens_details?.image_tokens ?? 0), usage.outputTokens)
  if (imageInput > 0) {
    usage.inputTokens -= imageInput
    usage.imageInputTokens = imageInput
  }
  if (imageOutput > 0) {
    usage.outputTokens -= imageOutput
    usage.imageOutputTokens = imageOutput
  }
  return usage
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function applyImageMetadata(usage: UsageData, response: OpenAIResponsePayload | undefined): UsageData {
  if (!response) return usage
  const imageTool = response.tools
    ?.map(recordOf)
    .find((tool) => tool?.type === 'image_generation')
  if (imageTool) {
    if (typeof imageTool.model === 'string' && imageTool.model) usage.imageModel = imageTool.model
    if (typeof imageTool.size === 'string' && imageTool.size) usage.imageSize = imageTool.size
  }
  const outputs = (response.output ?? [])
    .map(recordOf)
    .filter((item) => item?.type === 'image_generation_call' && typeof item.result === 'string' && item.result)
  if (outputs.length > 0) {
    usage.imageCount = outputs.length
    const first = outputs[0]!
    if (!usage.imageSize && typeof first.size === 'string' && first.size) usage.imageSize = first.size
    if (!usage.imageModel && typeof first.model === 'string' && first.model) usage.imageModel = first.model
  }
  return usage
}

/** Extracts usage from a non-streaming Responses API JSON body. */
export function parseJsonUsage(body: unknown): UsageData {
  const root = body as (OpenAIResponsePayload & { response?: OpenAIResponsePayload }) | null
  const response = root?.response ?? root ?? undefined
  return applyImageMetadata(parseOpenAIUsagePayload(response?.usage), response)
}

interface OpenAIStreamEvent {
  type?: string
  response?: OpenAIResponsePayload
}

/**
 * Accumulates usage from a Responses API SSE stream. The `response.completed`
 * event carries the final `response.usage`.
 */
export function createStreamParser() {
  const usage = emptyUsage()
  return {
    feed(event: unknown): void {
      const e = event as OpenAIStreamEvent
      if (e?.type === 'response.completed' && e.response?.usage) {
        Object.assign(usage, applyImageMetadata(parseOpenAIUsagePayload(e.response.usage), e.response))
      }
    },
    result(): UsageData {
      return { ...usage }
    },
  }
}
