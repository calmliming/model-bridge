import { usageWithCachedInput, type UsageData } from '../types'
import { createGeminiResponseTracker } from './responseSignal'

interface GeminiUsageMetadata {
  promptTokenCount?: number
  candidatesTokenCount?: number
  cachedContentTokenCount?: number
  thoughtsTokenCount?: number
  totalTokenCount?: number
}

const usageFields = ['promptTokenCount', 'candidatesTokenCount', 'cachedContentTokenCount',
  'thoughtsTokenCount', 'totalTokenCount'] as const

/** Snapshots may omit unchanged fields; only explicit valid counts replace them. */
function mergeReportedUsage(reported: GeminiUsageMetadata, body: unknown): void {
  const update = (body as { usageMetadata?: GeminiUsageMetadata } | null | undefined)?.usageMetadata
  if (!update || typeof update !== 'object') return
  for (const field of usageFields) {
    const value = update[field]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) reported[field] = value
  }
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
  const reported: GeminiUsageMetadata = {}
  mergeReportedUsage(reported, body)
  return mapUsage(reported)
}

/**
 * Accumulates usage from a Gemini streaming response. Each chunk may carry
 * `usageMetadata`; merge raw counters before splitting cache and thought usage.
 */
export function createStreamParser() {
  const reported: GeminiUsageMetadata = {}
  const tracker = createGeminiResponseTracker()
  return {
    feed(event: unknown): void {
      tracker.feed(event)
      mergeReportedUsage(reported, event)
    },
    result(): UsageData {
      return mapUsage(reported)
    },
    failure: tracker.failure,
  }
}
