import type { IncomingHttpHeaders } from 'node:http'

/** Forward protocol capabilities, never the client's gateway credentials. */
export function claudeProtocolHeaders(headers: IncomingHttpHeaders = {}): Record<string, string> {
  const forwarded: Record<string, string> = {}
  for (const name of ['anthropic-version', 'anthropic-beta', 'anthropic-workspace-id']) {
    const value = headers[name]
    if (value !== undefined) forwarded[name] = Array.isArray(value) ? value.join(',') : value
  }
  return forwarded
}
