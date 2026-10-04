import { redactUpstreamError } from '../../http/upstreamDiagnostics'
import { unwrapResponseEnvelope } from '../gemini/relay'

const GOOGLE_ERROR_STATUSES = new Set([
  'CANCELLED', 'UNKNOWN', 'INVALID_ARGUMENT', 'DEADLINE_EXCEEDED', 'NOT_FOUND',
  'ALREADY_EXISTS', 'PERMISSION_DENIED', 'RESOURCE_EXHAUSTED', 'FAILED_PRECONDITION',
  'ABORTED', 'OUT_OF_RANGE', 'UNIMPLEMENTED', 'INTERNAL', 'UNAVAILABLE',
  'DATA_LOSS', 'UNAUTHENTICATED',
])
const USAGE_FIELDS = ['promptTokenCount', 'candidatesTokenCount', 'cachedContentTokenCount',
  'thoughtsTokenCount', 'totalTokenCount'] as const

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** Google error messages can identify the private account pool outside URLs. */
export function sanitizeAntigravityErrorText(message: string): string {
  return redactUpstreamError(message
    .replace(/\bprojects\/[a-z0-9._~-]+/gi, 'projects/[redacted]')
    .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, '[redacted-email]')
    .replace(/\b((?:consumer|project(?:[ _-]+(?:id|number))?)\s*[:=]\s*)["']?[a-z0-9._:-]+["']?/gi, '$1[redacted-project]')
    .replace(/\b((?:consumer|project(?:[ _-]+(?:id|number))?)\s+)["']?[a-z0-9._:-]+["']?/gi, '$1[redacted-project]'))
}

export function antigravityClientError(payload: unknown, httpStatus = 502) {
  const root = object(unwrapResponseEnvelope(payload))
  const error = object(root?.error)
  const code = typeof error?.code === 'number' && Number.isInteger(error.code) && error.code >= 400 && error.code <= 599
    ? error.code : httpStatus >= 400 ? httpStatus : 502
  const status = typeof error?.status === 'string' && GOOGLE_ERROR_STATUSES.has(error.status) ? error.status : undefined
  const message = typeof error?.message === 'string' ? error.message
    : typeof root?.error === 'string' ? root.error
    : typeof payload === 'string' ? payload : `Antigravity upstream returned HTTP ${code}.`
  return { error: { code, message: sanitizeAntigravityErrorText(message) || `Antigravity upstream returned HTTP ${code}.`,
    ...(status ? { status } : {}) } }
}

/** Keep successful content intact; rebuild errors without private metadata. */
export function sanitizeAntigravityResponse(payload: unknown): unknown {
  const response = unwrapResponseEnvelope(payload)
  const root = object(response)
  if (!root?.error) return response
  const result: Record<string, unknown> = antigravityClientError(response)
  // A terminal error can still carry billable usage after partial generation.
  const usage = object(root.usageMetadata)
  if (usage) result.usageMetadata = Object.fromEntries(USAGE_FIELDS
    .filter(key => typeof usage[key] === 'number' && Number.isFinite(usage[key]) && Number(usage[key]) >= 0)
    .map(key => [key, usage[key]]))
  return result
}

/** Normalize native Gemini frames before the generic SSE rewriting path. */
export function sanitizeAntigravitySseBlock(block: string): string {
  const lines = block.split('\n')
  // Preserve established heartbeat frames for clients that accept comments;
  // other upstream framing metadata is not part of Gemini generation content.
  const output = lines.filter(line => /^:\s*(?:upstream heartbeat|heartbeat|keepalive|ping)\s*$/i.test(line))
  const payload = lines.filter(line => line.trimStart().startsWith('data:'))
    .map(line => line.trimStart().slice(5).trimStart()).join('\n').trim()
  if (payload === '[DONE]') output.push('data: [DONE]')
  else if (payload) {
    let response: unknown
    try { response = sanitizeAntigravityResponse(JSON.parse(payload)) }
    catch { response = antigravityClientError('Antigravity returned an invalid SSE event.') }
    output.push(`data: ${JSON.stringify(response)}`)
  }
  return output.join('\n')
}
