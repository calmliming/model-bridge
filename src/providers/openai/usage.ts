import { emptyUsage, usageWithCachedInput, type UsageData } from '../types'

interface OpenAIUsage {
  input_tokens?: number
  output_tokens?: number
  input_tokens_details?: { cached_tokens?: number }
  cached_tokens?: number
}

function mapUsage(u: OpenAIUsage | undefined): UsageData {
  return usageWithCachedInput(
    u?.input_tokens,
    u?.output_tokens,
    u?.input_tokens_details?.cached_tokens ?? u?.cached_tokens,
  )
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
