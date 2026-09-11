import { fetchWithConnectTimeout } from '../../http/upstream'

const DEFAULT_ANTHROPIC_VERSION = '2023-06-01'
// Sub2API is a relay-to-relay gateway that may route requests through its own
// backend pool. Stream responses can take longer than the default 10s connect
// timeout, especially when upstream models are processing large contexts.
const SUB2API_TIMEOUT_MS = 60_000

export function normalizeSub2ApiBaseUrl(raw: string | null | undefined): string {
  const base = raw?.trim().replace(/\/+$/, '')
  if (!base) throw new Error('Sub2API account has no Base URL')
  try {
    const url = new URL(base)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.search || url.hash || url.username || url.password) {
      throw new Error('invalid protocol')
    }
    const normalized = url.toString().replace(/\/+$/, '')
    return normalized.replace(/\/(?:v1|v1beta)$/, '')
  } catch {
    throw new Error('Sub2API account Base URL is invalid')
  }
}

/** Native Gemini gateway path, including Sub2API's /antigravity prefix when configured. */
export function relaySub2ApiGemini(
  apiKey: string,
  baseUrl: string | null,
  body: Record<string, unknown>,
  model: string,
  action: string,
): Promise<Response> {
  const streaming = action === 'streamGenerateContent'
  const path = `/v1beta/models/${encodeURIComponent(model)}:${action}${streaming ? '?alt=sse' : ''}`
  return fetchWithConnectTimeout(endpoint(baseUrl, path), {
    method: 'POST',
    headers: { ...jsonHeaders(apiKey, streaming ? 'text/event-stream' : 'application/json'), 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  }, SUB2API_TIMEOUT_MS)
}

function endpoint(baseUrl: string | null, path: string): string {
  return `${normalizeSub2ApiBaseUrl(baseUrl)}${path}`
}

function unsupportedAntigravityProtocol(baseUrl: string | null): Response | null {
  if (!normalizeSub2ApiBaseUrl(baseUrl).endsWith('/antigravity')) return null
  return new Response(JSON.stringify({ error: {
    type: 'invalid_request_error', code: 'antigravity_endpoint_unsupported',
    message: 'Antigravity 专用入口支持 Messages 和 Gemini 原生协议。Chat Completions / Responses 请使用 Sub2API 根地址，并在上游将 Key 绑定到 Antigravity 分组。',
  } }), { status: 400, headers: { 'content-type': 'application/json' } })
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
  }, SUB2API_TIMEOUT_MS)
}

export function relaySub2ApiChatCompletions(
  apiKey: string,
  baseUrl: string | null,
  body: Record<string, unknown>,
): Promise<Response> {
  const unsupported = unsupportedAntigravityProtocol(baseUrl)
  if (unsupported) return Promise.resolve(unsupported)
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
  }, SUB2API_TIMEOUT_MS)
}

export function relaySub2ApiResponses(
  apiKey: string,
  baseUrl: string | null,
  body: Record<string, unknown>,
): Promise<Response> {
  const unsupported = unsupportedAntigravityProtocol(baseUrl)
  if (unsupported) return Promise.resolve(unsupported)
  const upstreamBody = { ...body, stream: true }
  return fetchWithConnectTimeout(endpoint(baseUrl, '/v1/responses'), {
    method: 'POST',
    headers: jsonHeaders(apiKey, 'text/event-stream'),
    body: JSON.stringify(upstreamBody),
  }, SUB2API_TIMEOUT_MS)
}
