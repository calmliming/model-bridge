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
    // Anthropic folds thinking tokens into output_tokens and does not break
    // them out in the usage object, so there is nothing to report separately.
    reasoningTokens: 0,
    cacheCreateTokens: u?.cache_creation_input_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
  }
}

/** Extracts usage from a non-streaming /v1/messages JSON response. */
export function parseJsonUsage(body: unknown): UsageData {
  const usage = (body as { usage?: ClaudeUsage } | null | undefined)?.usage
  return mapUsage(usage)
}

interface ClaudeStreamEvent {
  type?: string
  message?: { usage?: ClaudeUsage }
  usage?: ClaudeUsage
}

const DELTA_COUNT_FIELDS = [
  ['input_tokens', 'inputTokens'],
  ['output_tokens', 'outputTokens'],
  ['cache_creation_input_tokens', 'cacheCreateTokens'],
  ['cache_read_input_tokens', 'cacheReadTokens'],
] as const

/**
 * Accumulates usage from a streamed SSE response. `message_start` carries the
 * initial counts and every `message_delta` carries cumulative counts (the last
 * one is final). Converted streams, e.g. Sub2API serving a GPT account over
 * Messages, report input 0 at start and the real input/cache only in the delta.
 */
export function createStreamParser() {
  const usage = emptyUsage()
  return {
    /** Feed one parsed SSE `data:` JSON object. */
    feed(event: unknown): void {
      const e = event as ClaudeStreamEvent
      if (e?.type === 'message_start' && e.message?.usage) {
        Object.assign(usage, mapUsage(e.message.usage))
      } else if (e?.type === 'message_delta' && e.usage) {
        for (const [field, key] of DELTA_COUNT_FIELDS) {
          const value = e.usage[field]
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue
          // Cumulative counts never shrink: a 0 after a positive count is a
          // placeholder. Cache buckets are not subtracted from input either;
          // providers disagree on whether input_tokens already includes them.
          if (value === 0 && usage[key] > 0) continue
          usage[key] = value
        }
      }
    },
    result(): UsageData {
      return { ...usage }
    },
  }
}
