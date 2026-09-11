import { emptyUsage, usageWithCachedInput } from '../types'
import * as claudeUsage from '../claude/usage'

interface MiniMaxResponse {
  service_tier?: string
  usage?: {
    input_tokens?: number
    output_tokens?: number
    input_tokens_details?: { cached_tokens?: number; cache_creation_tokens?: number; cache_write_tokens?: number }
    output_tokens_details?: { reasoning_tokens?: number }
  }
}

/** All MiniMax text/vision input is billed at the LLM rate, not GPT Image rates. */
export function parseJsonUsage(body: unknown) {
  const root = body as (MiniMaxResponse & { response?: MiniMaxResponse }) | null
  const response = root?.response ?? root
  const u = response?.usage
  const result = usageWithCachedInput(u?.input_tokens, u?.output_tokens,
    u?.input_tokens_details?.cached_tokens, u?.output_tokens_details?.reasoning_tokens,
    u?.input_tokens_details?.cache_creation_tokens ?? u?.input_tokens_details?.cache_write_tokens)
  if (typeof response?.service_tier === 'string') result.serviceTier = response.service_tier
  return result
}

export function createStreamParser() {
  const usage = emptyUsage()
  return {
    feed(event: unknown) {
      const e = event as { type?: string; response?: { usage?: unknown; service_tier?: unknown } } | null
      if (typeof e?.response?.service_tier === 'string') usage.serviceTier = e.response.service_tier
      if (['response.completed', 'response.failed', 'response.incomplete'].includes(e?.type ?? '') && e?.response?.usage) {
        Object.assign(usage, parseJsonUsage(e))
      }
    },
    result: () => ({ ...usage }),
  }
}

function reportedTier(value: unknown): string | undefined {
  const body = value as { service_tier?: unknown; message?: { service_tier?: unknown } } | null
  const tier = body?.service_tier ?? body?.message?.service_tier
  return typeof tier === 'string' ? tier : undefined
}

export function parseMessagesUsage(body: unknown) {
  return { ...claudeUsage.parseJsonUsage(body), serviceTier: reportedTier(body) }
}

export function createMessagesStreamParser() {
  const parser = claudeUsage.createStreamParser()
  let serviceTier: string | undefined
  return {
    feed(event: unknown) {
      parser.feed(event)
      serviceTier = reportedTier(event) ?? serviceTier
    },
    result: () => ({ ...parser.result(), serviceTier }),
  }
}
