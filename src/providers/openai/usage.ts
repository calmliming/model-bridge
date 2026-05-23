import { emptyUsage, type UsageData } from '../types'

interface OpenAIUsage {
  input_tokens?: number
  output_tokens?: number
  input_tokens_details?: { cached_tokens?: number }
  cached_tokens?: number
}

function mapUsage(u: OpenAIUsage | undefined): UsageData {
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    // OpenAI does not surface cache-write separately on /responses.
    cacheCreateTokens: 0,
    cacheReadTokens: u?.input_tokens_details?.cached_tokens ?? u?.cached_tokens ?? 0,
  }
}

/** Extracts usage from a non-streaming Responses API JSON body. */
export function parseJsonUsage(body: unknown): UsageData {
  const root = body as { response?: { usage?: OpenAIUsage }; usage?: OpenAIUsage } | null
  return mapUsage(root?.response?.usage ?? root?.usage)
}

interface OpenAIStreamEvent {
  type?: string
  response?: { usage?: OpenAIUsage }
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
        Object.assign(usage, mapUsage(e.response.usage))
      }
    },
    result(): UsageData {
      return { ...usage }
    },
  }
}
