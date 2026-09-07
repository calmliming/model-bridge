const REQUEST_ID_HEADERS = ['x-request-id', 'request-id', 'x-amzn-requestid', 'x-goog-request-id', 'x-correlation-id']

export function upstreamRequestId(headers: Headers, customHeader?: unknown): string | null {
  const names = typeof customHeader === 'string' && isRequestIdHeader(customHeader)
    ? [customHeader, ...REQUEST_ID_HEADERS] : REQUEST_ID_HEADERS
  for (const name of names) {
    const value = headers.get(name)?.trim()
    if (value && /^[\w.:/-]{1,200}$/.test(value)) return value
  }
  return null
}

export function isRequestIdHeader(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,99}$/i.test(value)
    && !/^(authorization|proxy-authorization|cookie|set-cookie|authentication-info)$/i.test(value)
}

/** Keep useful error text without persisting URLs, bearer tokens, or API keys. */
export function redactUpstreamError(message: string): string {
  return message
    .replace(/https?:\/\/[^\s"'<>)\]]+/gi, '[redacted-url]')
    .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|mb)-[a-zA-Z0-9_-]{8,}/g, '[redacted-key]')
    .slice(0, 2_000)
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function streamFailureDetails(event: unknown): { code: string; message: string } | null {
  const root = record(event)
  if (!root) return null
  const response = record(root.response)
  const error = record(response?.error) ?? record(root.error)
  if (!error && root.type !== 'response.failed' && root.type !== 'response.incomplete' && root.type !== 'error') return null
  const reason = record(response?.incomplete_details)?.reason
  const rawCode = error?.code ?? error?.type ?? reason ?? root.type
  const code = typeof rawCode === 'string' ? rawCode.trim().slice(0, 200) : 'upstream_stream_failed'
  const message = typeof error?.message === 'string' ? error.message : `Upstream response ended with ${code}.`
  return { code, message: redactUpstreamError(message) }
}
