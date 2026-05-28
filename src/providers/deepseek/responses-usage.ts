import { emptyUsage, type UsageData } from '../types'

/**
 * Usage parser for the DeepSeek → Responses adapter. It consumes events
 * AFTER the StreamTransform in `stream.ts` has rewritten Chat Completions
 * chunks into Responses-API events, so the relevant payload is the same
 * shape as the OpenAI Responses upstream: `response.completed` carries the
 * final `response.usage` object.
 */

interface ResponsesUsage {
  input_tokens?: number
  output_tokens?: number
  input_tokens_details?: { cached_tokens?: number }
}

function mapUsage(u: ResponsesUsage | undefined): UsageData {
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheCreateTokens: 0, // DeepSeek does not separate cache-write tokens.
    cacheReadTokens: u?.input_tokens_details?.cached_tokens ?? 0,
  }
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
 * `forceStream: true` so /api/deepseek/v1/responses always streams. Kept
 * for interface symmetry with other providers.
 */
export function parseJsonUsage(body: unknown): UsageData {
  const root = body as { response?: { usage?: ResponsesUsage }; usage?: ResponsesUsage } | null
  return mapUsage(root?.response?.usage ?? root?.usage)
}
