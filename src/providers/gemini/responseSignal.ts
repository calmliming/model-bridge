export interface GeminiResponseFailure { code: string; message: string }

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

const FILTER_REASONS = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII',
  'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT', 'IMAGE_RECITATION'])

/** Observe native Gemini results without rewriting their wire representation. */
export function createGeminiResponseTracker() {
  let seenResult = false
  let failure: GeminiResponseFailure | null = null
  return {
    feed(value: unknown): void {
      const root = object(value)
      const body = object(root?.response) ?? root
      if (!body) return
      const error = object(body.error)
      if (error) {
        const reason = typeof error.status === 'string' ? error.status : String(error.code ?? 'UNKNOWN')
        failure = { code: `gemini_upstream_${reason}`.slice(0, 200),
          message: typeof error.message === 'string' ? error.message : 'Gemini returned an error inside its response.' }
        return
      }
      const feedback = object(body.promptFeedback)
      const candidates = Array.isArray(body.candidates) ? body.candidates.map(object) : []
      const primary = candidates.find(candidate => candidate && (candidate.index == null || candidate.index === 0))
      const block = typeof feedback?.blockReason === 'string' ? feedback.blockReason : ''
      const finish = typeof primary?.finishReason === 'string' ? primary.finishReason : ''
      const reason = block && block !== 'BLOCK_REASON_UNSPECIFIED' ? block : FILTER_REASONS.has(finish) ? finish : ''
      if (reason && !failure?.code.startsWith('gemini_upstream_')) {
        failure = { code: `gemini_policy_${reason}`.slice(0, 200), message: `Gemini content policy result: ${reason}.` }
      }
      // Generation-side stops (including malformed function calls) are model
      // results, not transport/account failures. countTokens is also valid.
      if (candidates.some(candidate => candidate && Object.keys(candidate).length > 0)
        || typeof body.totalTokens === 'number' || reason) seenResult = true
    },
    failure(): GeminiResponseFailure | null {
      return failure ?? (seenResult ? null : { code: 'gemini_empty_response', message: 'Gemini returned no generation result.' })
    },
  }
}
