import { emptyUsage, type UsageData } from '../types'

interface ClaudeUsage {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

function mapUsage(u: ClaudeUsage | undefined): UsageData {
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheCreateTokens: u?.cache_creation_input_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
  }
}

/** Extracts usage from a non-streaming /v1/messages JSON response. */
export function parseUsageFromJson(body: unknown): UsageData {
  const usage = (body as { usage?: ClaudeUsage } | null | undefined)?.usage
  return mapUsage(usage)
}

interface ClaudeStreamEvent {
  type?: string
  message?: { usage?: ClaudeUsage }
  usage?: ClaudeUsage
}

/**
 * Accumulates usage from a streamed SSE response. Claude reports the
 * input/cache counts in `message_start` and the running output count in
 * each `message_delta` (the last one is final).
 */
export function createStreamUsageParser() {
  const usage = emptyUsage()
  return {
    /** Feed one parsed SSE `data:` JSON object. */
    feed(event: unknown): void {
      const e = event as ClaudeStreamEvent
      if (e?.type === 'message_start' && e.message?.usage) {
        Object.assign(usage, mapUsage(e.message.usage))
      } else if (e?.type === 'message_delta' && typeof e.usage?.output_tokens === 'number') {
        usage.outputTokens = e.usage.output_tokens
      }
    },
    result(): UsageData {
      return { ...usage }
    },
  }
}
