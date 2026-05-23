import { emptyUsage, type UsageData } from '../types'

interface GeminiUsageMetadata {
  promptTokenCount?: number
  candidatesTokenCount?: number
  cachedContentTokenCount?: number
  totalTokenCount?: number
}

function mapUsage(u: GeminiUsageMetadata | undefined): UsageData {
  return {
    inputTokens: u?.promptTokenCount ?? 0,
    outputTokens: u?.candidatesTokenCount ?? 0,
    // Gemini does not surface cache-write separately on the public API.
    cacheCreateTokens: 0,
    cacheReadTokens: u?.cachedContentTokenCount ?? 0,
  }
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
  return {
    feed(event: unknown): void {
      const u = (event as { usageMetadata?: GeminiUsageMetadata } | null | undefined)?.usageMetadata
      if (u) Object.assign(usage, mapUsage(u))
    },
    result(): UsageData {
      return { ...usage }
    },
  }
}
