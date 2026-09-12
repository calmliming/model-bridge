import { emptyUsage, usageWithCachedInput, type UsageData } from '../types'
import { createGeminiResponseTracker } from './responseSignal'

interface GeminiUsageMetadata {
  promptTokenCount?: number
  candidatesTokenCount?: number
  cachedContentTokenCount?: number
  thoughtsTokenCount?: number
  totalTokenCount?: number
}

function mapUsage(u: GeminiUsageMetadata | undefined): UsageData {
  return usageWithCachedInput(
    u?.promptTokenCount,
    Math.max(0, u?.candidatesTokenCount ?? 0) + Math.max(0, u?.thoughtsTokenCount ?? 0),
    u?.cachedContentTokenCount,
    u?.thoughtsTokenCount,
  )
}

/** Extracts usage from a (already-unwrapped) standard Gemini response body. */
export function parseJsonUsage(body: unknown): UsageData {
  const usage = (body as { usageMetadata?: GeminiUsageMetadata } | null | undefined)?.usageMetadata
  return mapUsage(usage)
}

/**
 * Accumulates usage from a Gemini streaming response. Each chunk may carry
 * `usageMetadata`; the last one is final.
 */
export function createStreamParser() {
  const usage = emptyUsage()
  const tracker = createGeminiResponseTracker()
  return {
    feed(event: unknown): void {
      tracker.feed(event)
      const u = (event as { usageMetadata?: GeminiUsageMetadata } | null | undefined)?.usageMetadata
      if (u) Object.assign(usage, mapUsage(u))
    },
    result(): UsageData {
      return { ...usage }
    },
    failure: tracker.failure,
  }
}
