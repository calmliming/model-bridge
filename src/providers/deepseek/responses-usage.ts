import { emptyUsage, usageWithCachedInput, type UsageData } from '../types'

/**
 * Usage parser for DeepSeek's native Responses API. The relevant payload is
 * the same shape as the OpenAI Responses protocol: `response.completed`
 * carries the final `response.usage` object.
 */

interface ResponsesUsage {
  input_tokens?: number
  output_tokens?: number
  input_tokens_details?: { cached_tokens?: number }
  output_tokens_details?: { reasoning_tokens?: number }
}

function mapUsage(u: ResponsesUsage | undefined): UsageData {
  return usageWithCachedInput(
    u?.input_tokens,
    u?.output_tokens,
    u?.input_tokens_details?.cached_tokens,
    u?.output_tokens_details?.reasoning_tokens,
  )
}

interface ResponsesStreamEvent {
  type?: string
  response?: { usage?: ResponsesUsage }
}

export function createStreamParser() {
  const usage = emptyUsage()
  return {
    feed(event: unknown): void {
      const e = event as ResponsesStreamEvent
      if (e?.type === 'response.completed' && e.response?.usage) {
        Object.assign(usage, mapUsage(e.response.usage))
      }
    },
    result(): UsageData {
      return { ...usage }
    },
  }
}

/**
 * The relay currently forces streaming for Codex compatibility. This parser
 * also accepts a non-stream response for callers that use the helper directly.
 */
export function parseJsonUsage(body: unknown): UsageData {
  const root = body as { response?: { usage?: ResponsesUsage }; usage?: ResponsesUsage } | null
  return mapUsage(root?.response?.usage ?? root?.usage)
}
