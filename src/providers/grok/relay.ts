import {
  GROK_CHAT_COMPLETIONS_URL,
  GROK_DEFAULT_MODEL,
  GROK_RESPONSES_URL,
  GROK_USER_AGENT,
} from './constants'

// Bare/aliased Grok names → concrete xAI model ids. Anything already concrete
// (e.g. "grok-4.3", "grok-build-0.1") passes through untouched.
const MODEL_ALIASES: Record<string, string> = {
  grok: GROK_DEFAULT_MODEL,
  'grok-latest': GROK_DEFAULT_MODEL,
  'grok-4.5-latest': 'grok-4.5',
  'grok-build': 'grok-build-0.1',
  'grok-build-latest': 'grok-build-0.1',
}

/** Resolves a requested Grok model name to a concrete xAI model id. */
export function mapGrokModel(model: string): string {
  if (typeof model !== 'string') return GROK_DEFAULT_MODEL
  const key = model.trim().toLowerCase()
  if (!key) return GROK_DEFAULT_MODEL
  return MODEL_ALIASES[key] ?? model
}

// Fields the xAI Responses endpoint rejects (present on OpenAI Responses bodies
// but unsupported upstream). Reasoning effort is intentionally preserved.
const RESPONSES_FORBIDDEN_FIELDS = ['prompt_cache_retention', 'safety_identifier'] as const

/** Normalises an incoming Responses-API body to what the xAI backend accepts. */
export function normalizeGrokResponsesBody(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body }
  for (const field of RESPONSES_FORBIDDEN_FIELDS) delete out[field]
  out.stream = true
  out.store = false
  return out
}

/** Relays a /v1/responses request to the xAI backend with an OAuth token. */
export function relayGrokResponses(
  accessToken: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(GROK_RESPONSES_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'user-agent': GROK_USER_AGENT,
    },
    body: JSON.stringify(normalizeGrokResponsesBody(body)),
  })
}

/** Normalises a Chat Completions body; requests usage on streamed responses. */
export function normalizeGrokChatCompletionsBody(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body }
  delete out.safety_identifier
  if (out.stream === true) {
    const streamOptions =
      out.stream_options && typeof out.stream_options === 'object'
        ? (out.stream_options as Record<string, unknown>)
        : {}
    out.stream_options = { ...streamOptions, include_usage: true }
  }
  return out
}

/** Relays a Chat Completions request to xAI's OpenAI-compatible endpoint. */
export function relayGrokChatCompletions(
  accessToken: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const upstreamBody = normalizeGrokChatCompletionsBody(body)
  return fetch(GROK_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: upstreamBody.stream === true ? 'text/event-stream' : 'application/json',
      'user-agent': GROK_USER_AGENT,
    },
    body: JSON.stringify(upstreamBody),
  })
}
