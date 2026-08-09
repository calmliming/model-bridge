import { fetchWithConnectTimeout } from '../../http/upstream'

const DEFAULT_ANTHROPIC_VERSION = '2023-06-01'

export function normalizeSub2ApiBaseUrl(raw: string | null | undefined): string {
  const base = raw?.trim().replace(/\/+$/, '')
  if (!base) throw new Error('Sub2API account has no Base URL')
  try {
    const url = new URL(base)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('invalid protocol')
    }
    const normalized = url.toString().replace(/\/+$/, '')
    return normalized.endsWith('/v1') ? normalized.slice(0, -3) : normalized
  } catch {
    throw new Error('Sub2API account Base URL is invalid')
  }
}

function endpoint(baseUrl: string | null, path: string): string {
  return `${normalizeSub2ApiBaseUrl(baseUrl)}${path}`
}

function jsonHeaders(apiKey: string, accept: string): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    'x-api-key': apiKey,
    'content-type': 'application/json',
    accept,
  }
}

export function relaySub2ApiMessages(
  apiKey: string,
  baseUrl: string | null,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetchWithConnectTimeout(endpoint(baseUrl, '/v1/messages'), {
    method: 'POST',
    headers: {
      ...jsonHeaders(apiKey, body.stream === true ? 'text/event-stream' : 'application/json'),
      'anthropic-version': DEFAULT_ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  })
}

export function relaySub2ApiChatCompletions(
  apiKey: string,
  baseUrl: string | null,
  body: Record<string, unknown>,
): Promise<Response> {
  const upstreamBody = { ...body }
  if (upstreamBody.stream === true) {
    const streamOptions =
      upstreamBody.stream_options && typeof upstreamBody.stream_options === 'object'
        ? (upstreamBody.stream_options as Record<string, unknown>)
        : {}
    upstreamBody.stream_options = { ...streamOptions, include_usage: true }
  }

  return fetchWithConnectTimeout(endpoint(baseUrl, '/v1/chat/completions'), {
    method: 'POST',
    headers: jsonHeaders(
      apiKey,
      upstreamBody.stream === true ? 'text/event-stream' : 'application/json',
    ),
    body: JSON.stringify(upstreamBody),
  })
}

export function relaySub2ApiResponses(
  apiKey: string,
  baseUrl: string | null,
  body: Record<string, unknown>,
): Promise<Response> {
  const upstreamBody = { ...body, stream: true }
  return fetchWithConnectTimeout(endpoint(baseUrl, '/v1/responses'), {
    method: 'POST',
    headers: jsonHeaders(apiKey, 'text/event-stream'),
    body: JSON.stringify(upstreamBody),
  })
}
