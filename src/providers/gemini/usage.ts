import { emptyUsage, usageWithCachedInput, type UsageData } from '../types'

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
    u?.candidatesTokenCount,
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
