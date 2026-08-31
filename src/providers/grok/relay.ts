import {
  GROK_CHAT_COMPLETIONS_URL,
  GROK_DEFAULT_MODEL,
  GROK_RESPONSES_URL,
  GROK_USER_AGENT,
} from './constants'
import { fetchWithConnectTimeout } from '../../http/upstream'

// Bare/aliased Grok names → concrete xAI model ids. Anything already concrete
// (e.g. "grok-4.3", "grok-build-0.1") passes through untouched.
const MODEL_ALIASES: Record<string, string> = {
  grok: GROK_DEFAULT_MODEL,
  'grok-latest': GROK_DEFAULT_MODEL,
  'grok-4.6-latest': 'grok-4.6',
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
const GROK_SAFE_FUNCTION_PARAMETERS = { type: 'object', properties: {}, additionalProperties: true }

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function metadataSessionId(value: unknown): string | null {
  const metadata = recordOf(value)
  if (!metadata) return null
  for (const key of ['session_id', 'sessionId', 'conversation_id', 'conversationId']) {
    const direct = metadata[key]
    if (typeof direct === 'string' && direct.trim()) return direct.trim()
  }
  const nested = metadata.user_id
  if (typeof nested !== 'string' || !nested.trim()) return null
  try {
    const parsed = recordOf(JSON.parse(nested))
    if (!parsed) return null
    for (const key of ['session_id', 'sessionId', 'conversation_id', 'conversationId']) {
      const candidate = parsed[key]
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
    }
  } catch {
    // Opaque user ids are not cache/session identifiers.
  }
  return null
}

/** Returns true when a function schema has a non-object union at its root. */
export function grokFunctionParametersHaveInvalidUnionRoot(value: unknown): boolean {
  const parameters = recordOf(value)
  if (!parameters) return false
  for (const keyword of ['anyOf', 'oneOf']) {
    const branches = parameters[keyword]
    if (!Array.isArray(branches) || branches.length === 0) continue
    if (branches.some((branch) => {
      const row = recordOf(branch)
      return !row || typeof row.type !== 'string' || row.type.toLowerCase() !== 'object'
    })) return true
  }
  return false
}

function sanitizeGrokTool(value: unknown): unknown {
  const tool = recordOf(value)
  if (!tool) return value
  const out: Record<string, unknown> = { ...tool }
  if (Array.isArray(out.tools)) out.tools = out.tools.map(sanitizeGrokTool)
  if (out.type === 'function' && grokFunctionParametersHaveInvalidUnionRoot(out.parameters)) {
    out.parameters = { ...GROK_SAFE_FUNCTION_PARAMETERS }
    if (out.strict === true) out.strict = false
  }
  return out
}

/** Sanitizes only invalid root unions, preserving valid nested tool schemas. */
export function sanitizeGrokResponsesTools(tools: unknown[]): unknown[] {
  return tools.map(sanitizeGrokTool)
}

/** Normalises an incoming Responses-API body to what the xAI backend accepts. */
export function normalizeGrokResponsesBody(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body }
  for (const field of RESPONSES_FORBIDDEN_FIELDS) delete out[field]
  const metadataKey = metadataSessionId(out.metadata)
  if (metadataKey && (typeof out.prompt_cache_key !== 'string' || !out.prompt_cache_key.trim())) {
    out.prompt_cache_key = metadataKey
  }
  delete out.metadata
  if (Array.isArray(out.tools)) out.tools = sanitizeGrokResponsesTools(out.tools)
  out.stream = true
  out.store = false
  return out
}

/** Relays a /v1/responses request to the xAI backend with an OAuth token. */
export function relayGrokResponses(
  accessToken: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetchWithConnectTimeout(GROK_RESPONSES_URL, {
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
  return fetchWithConnectTimeout(GROK_CHAT_COMPLETIONS_URL, {
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
