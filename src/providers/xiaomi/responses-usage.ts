import { emptyUsage, usageWithCachedInput, type UsageData } from '../types'

/**
 * Usage parser for the Xiaomi MiMo → Responses adapter. It consumes events
 * AFTER the StreamTransform in `stream.ts` has rewritten Chat Completions
 * chunks into Responses-API events, so the relevant payload is the same
 * shape as the OpenAI Responses upstream: `response.completed` carries the
 * final `response.usage` object.
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
 * Non-stream path is not exercised in practice — the relay handler is
 * `forceStream: true` so /api/xiaomi/v1/responses always streams. Kept
 * for interface symmetry with other providers.
 */
export function parseJsonUsage(body: unknown): UsageData {
  const root = body as { response?: { usage?: ResponsesUsage }; usage?: ResponsesUsage } | null
  return mapUsage(root?.response?.usage ?? root?.usage)
}
