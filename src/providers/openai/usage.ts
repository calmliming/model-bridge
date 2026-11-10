import { hasReportedUsage } from '../usageSource'
import { emptyUsage, usageWithCachedInput, type UsageData } from '../types'

export interface CacheWriteUsage {
  cache_write_tokens?: number
  cache_creation_input_tokens?: number
  cache_write_input_tokens?: number
  cache_creation_tokens?: number
}

export interface CacheWriteDetails {
  cache_write_tokens?: number
  cache_creation_tokens?: number
  cache_write_tokens_details?: {
    ttl_30m_tokens?: number
    ttl_12h_tokens?: number
  } | null
}

interface OpenAIUsage extends CacheWriteUsage {
  prompt_cache_hit_tokens?: number
  input_tokens?: number
  output_tokens?: number
  input_tokens_details?: CacheWriteDetails & {
    cached_tokens?: number
    image_tokens?: number
  }
  output_tokens_details?: { reasoning_tokens?: number; image_tokens?: number }
  cached_tokens?: number
}

export function reportedCacheWrites(usage: CacheWriteUsage | undefined, details: CacheWriteDetails | undefined): number | undefined {
  return details?.cache_write_tokens ?? details?.cache_creation_tokens ?? usage?.cache_write_tokens ??
    usage?.cache_creation_input_tokens ?? usage?.cache_write_input_tokens ?? usage?.cache_creation_tokens
}

export function applyCacheWriteDetails(usage: UsageData, reported: number | undefined, details: CacheWriteDetails | undefined): UsageData {
  const split = details?.cache_write_tokens_details
  const short = split?.ttl_30m_tokens
  const long = split?.ttl_12h_tokens
  // If input normalization capped the aggregate, the split is no longer usable.
  if (usage.cacheCreateTokens > 0 && usage.cacheCreateTokens === reported && typeof short === 'number' && typeof long === 'number' &&
      Number.isSafeInteger(short) && Number.isSafeInteger(long) && short >= 0 && long >= 0 &&
      short === usage.cacheCreateTokens - long) {
    usage.cacheCreate12hTokens = long
  }
  return usage
}

interface OpenAIResponsePayload {
  service_tier?: string
  usage?: OpenAIUsage
  tools?: unknown[]
  output?: unknown[]
}

export function parseOpenAIUsagePayload(u: OpenAIUsage | undefined): UsageData {
  const cacheWrites = reportedCacheWrites(u, u?.input_tokens_details)
  const usage = usageWithCachedInput(
    u?.input_tokens,
    u?.output_tokens,
    u?.input_tokens_details?.cached_tokens ?? u?.cached_tokens ?? u?.prompt_cache_hit_tokens,
    u?.output_tokens_details?.reasoning_tokens,
    cacheWrites,
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
  return applyCacheWriteDetails(usage, cacheWrites, u?.input_tokens_details)
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function applyImageMetadata(usage: UsageData, response: OpenAIResponsePayload | undefined): UsageData {
  if (!response) return usage
  if (typeof response.service_tier === 'string') usage.serviceTier = response.service_tier
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
  let reported: OpenAIUsage = {}
  return {
    feed(event: unknown): void {
      const e = event as OpenAIStreamEvent
      if (typeof e?.response?.service_tier === 'string') usage.serviceTier = e.response.service_tier
      if (e?.response?.usage && hasReportedUsage(e.response.usage)) {
        reported = { ...reported, ...e.response.usage,
          input_tokens_details: { ...reported.input_tokens_details, ...e.response.usage.input_tokens_details },
          output_tokens_details: { ...reported.output_tokens_details, ...e.response.usage.output_tokens_details } }
        delete usage.cacheCreate12hTokens
        Object.assign(usage, applyImageMetadata(parseOpenAIUsagePayload(reported), e.response))
      }
    },
    result(): UsageData {
      return { ...usage }
    },
  }
}
