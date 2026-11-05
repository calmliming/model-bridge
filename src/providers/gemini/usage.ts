import { createHash } from 'node:crypto'
import { usageWithCachedInput, type UsageData } from '../types'
import { createGeminiResponseTracker } from './responseSignal'

interface GeminiUsageMetadata {
  promptTokenCount?: number
  candidatesTokenCount?: number
  cachedContentTokenCount?: number
  thoughtsTokenCount?: number
  promptTokensDetails?: Array<{ modality?: string; tokenCount?: number }>
  candidatesTokensDetails?: Array<{ modality?: string; tokenCount?: number }>
  cacheTokensDetails?: Array<{ modality?: string; tokenCount?: number }>
  totalTokenCount?: number
}

const usageFields = ['promptTokenCount', 'candidatesTokenCount', 'cachedContentTokenCount',
  'thoughtsTokenCount', 'totalTokenCount'] as const

/** Snapshots may omit unchanged fields; only explicit valid counts replace them. */
function mergeReportedUsage(reported: GeminiUsageMetadata, body: unknown): void {
  const update = (body as { usageMetadata?: GeminiUsageMetadata } | null | undefined)?.usageMetadata
  if (!update || typeof update !== 'object') return
  for (const field of ['promptTokensDetails', 'candidatesTokensDetails', 'cacheTokensDetails'] as const) {
    if (Array.isArray(update[field])) reported[field] = update[field]
  }
  for (const field of usageFields) {
    const value = update[field]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) reported[field] = value
  }
}

function mapUsage(u: GeminiUsageMetadata | undefined): UsageData {
  const usage = usageWithCachedInput(
    u?.promptTokenCount,
    Math.max(0, u?.candidatesTokenCount ?? 0) + Math.max(0, u?.thoughtsTokenCount ?? 0),
    u?.cachedContentTokenCount,
    u?.thoughtsTokenCount,
  )
  const images = (details: GeminiUsageMetadata['promptTokensDetails']) => (details ?? []).reduce((sum, d) => sum + (d.modality === 'IMAGE' && Number.isFinite(d.tokenCount) ? Math.max(0, d.tokenCount!) : 0), 0)
  const imageInput = Math.min(usage.inputTokens, images(u?.promptTokensDetails))
  const imageOutput = Math.min(usage.outputTokens, images(u?.candidatesTokensDetails))
  const imageCache = Math.min(usage.cacheReadTokens, images(u?.cacheTokensDetails))
  if (imageInput) { usage.inputTokens -= imageInput; usage.imageInputTokens = imageInput }
  if (imageOutput) { usage.outputTokens -= imageOutput; usage.imageOutputTokens = imageOutput }
  if (imageCache) { usage.cacheReadTokens -= imageCache; usage.imageCacheReadTokens = imageCache }
  return usage
}

function observeImages(seen: Set<string>, raw: unknown): void {
  const body = raw as { candidates?: Array<{ index?: number; content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string }; fileData?: { mimeType?: string; fileUri?: string } }> } }> }
  for (const [ci, candidate] of (body?.candidates ?? []).entries()) {
    for (const [pi, part] of (candidate.content?.parts ?? []).entries()) {
      const media = part.inlineData ?? part.fileData
      if (media?.mimeType?.startsWith('image/')) {
        const source = part.inlineData?.data ?? part.fileData?.fileUri
        if (source) seen.add(String(candidate.index ?? ci) + ':' + pi + ':' + createHash('sha256').update(source).digest('hex'))
      }
    }
  }
}

/** Extracts usage from a (already-unwrapped) standard Gemini response body. */
export function parseJsonUsage(body: unknown): UsageData {
  const reported: GeminiUsageMetadata = {}
  mergeReportedUsage(reported, body)
  const usage = mapUsage(reported)
  const seen = new Set<string>()
  observeImages(seen, body)
  if (seen.size) usage.imageCount = seen.size
  return usage
}

/**
 * Accumulates usage from a Gemini streaming response. Each chunk may carry
 * `usageMetadata`; merge raw counters before splitting cache and thought usage.
 */
export function createStreamParser() {
  const reported: GeminiUsageMetadata = {}
  const tracker = createGeminiResponseTracker()
  const seen = new Set<string>()
  return {
    feed(event: unknown): void {
      tracker.feed(event)
      observeImages(seen, event)
      mergeReportedUsage(reported, event)
    },
    result(): UsageData {
      const usage = mapUsage(reported)
      if (seen.size) usage.imageCount = seen.size
      return usage
    },
    failure: tracker.failure,
  }
}
