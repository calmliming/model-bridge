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

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

interface GrokToolOutputImage {
  callId: string
  url: string
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value != null)
}

function grokToolOutputImageUrl(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  const image = recordOf(value)
  if (!image) return ''
  for (const field of ['url', 'image_url', 'file_url'] as const) {
    const raw = image[field]
    if (typeof raw === 'string' && raw.trim()) return raw.trim()
    const nested = recordOf(raw)
    if (nested && typeof nested.url === 'string' && nested.url.trim()) return nested.url.trim()
  }
  return ''
}

function isEmptyBase64Image(value: string): boolean {
  return /^data:image\/[^;,]+;base64,\s*$/i.test(value.trim())
}

interface StrippedGrokToolOutput {
  value: unknown
  images: GrokToolOutputImage[]
  keep: boolean
}

function stripGrokToolOutputImages(value: unknown, callId: string): StrippedGrokToolOutput {
  if (Array.isArray(value)) {
    const filtered: unknown[] = []
    const images: GrokToolOutputImage[] = []
    for (const item of value) {
      const stripped = stripGrokToolOutputImages(item, callId)
      images.push(...stripped.images)
      if (stripped.keep) filtered.push(stripped.value)
    }
    return { value: filtered, images, keep: filtered.length > 0 }
  }

  const row = recordOf(value)
  if (!row) return { value, images: [], keep: value != null }

  const type = stringValue(row.type).toLowerCase()
  if (['image', 'image_url', 'input_image'].includes(type)) {
    const url = grokToolOutputImageUrl(row)
    return {
      value: null,
      images: url && !isEmptyBase64Image(url) ? [{ callId, url }] : [],
      keep: false,
    }
  }

  const filtered: Record<string, unknown> = { ...row }
  const images: GrokToolOutputImage[] = []
  if (Array.isArray(filtered.images)) {
    for (const rawImage of filtered.images) {
      const url = grokToolOutputImageUrl(rawImage)
      if (url && !isEmptyBase64Image(url)) images.push({ callId, url })
    }
    delete filtered.images
  }
  for (const field of ['content', 'output', 'results'] as const) {
    if (!(field in filtered)) continue
    const stripped = stripGrokToolOutputImages(filtered[field], callId)
    images.push(...stripped.images)
    if (stripped.keep) filtered[field] = stripped.value
    else delete filtered[field]
  }
  return { value: filtered, images, keep: Object.keys(filtered).length > 0 }
}

function grokModelInputString(value: unknown, fallback = '(empty)'): string {
  if (typeof value === 'string') return value.trim() || fallback
  if (value == null) return fallback
  try {
    return JSON.stringify(value) || fallback
  } catch {
    return fallback
  }
}

function grokStructuredToolOutputString(value: unknown, fallback = '(empty)'): string {
  if (!Array.isArray(value) || value.length === 0) return grokModelInputString(value, fallback)
  const texts: string[] = []
  for (const rawPart of value) {
    const part = recordOf(rawPart)
    const type = stringValue(part?.type).toLowerCase()
    if (!part || !['text', 'input_text', 'output_text'].includes(type)) {
      return grokModelInputString(value, fallback)
    }
    const text = stringValue(part.text)
    if (text) texts.push(text)
  }
  return texts.length ? texts.join('\n') : fallback
}

function normalizeGrokToolOutput(value: unknown, callId: string): {
  output: string
  images: GrokToolOutputImage[]
} {
  const stripped = stripGrokToolOutputImages(value, callId)
  return {
    output: stripped.images.length
      ? stripped.keep
        ? grokStructuredToolOutputString(stripped.value)
        : '(empty)'
      : grokModelInputString(value),
    images: stripped.images,
  }
}

function isGrokToolOutputItem(item: Record<string, unknown>): boolean {
  const type = stringValue(item.type).toLowerCase()
  const role = stringValue(item.role).toLowerCase()
  return (
    role === 'tool' ||
    role === 'function' ||
    type.endsWith('_call_output') ||
    ['tool_result', 'tool_output', 'function_result'].includes(type)
  )
}

function appendGrokToolOutputImageMessage(
  items: unknown[],
  images: GrokToolOutputImage[],
): void {
  if (!images.length) return
  const content: Array<Record<string, unknown>> = []
  let lastCallId = ''
  for (const image of images) {
    if (image.callId !== lastCallId) {
      content.push({
        type: 'input_text',
        text: `[Tool output media for call ${image.callId}]`,
      })
      lastCallId = image.callId
    }
    content.push({ type: 'input_image', image_url: image.url })
  }
  items.push({ type: 'message', role: 'user', content })
}

/**
 * xAI requires function_call_output.output to be a string. Grok Shell attaches
 * read-file images either to `images` or as structured output parts, so lift
 * those images into one following user message without breaking call/output
 * adjacency.
 */
export function sanitizeGrokResponsesInput(input: unknown[]): unknown[] {
  const filtered: unknown[] = []
  let pendingImages: GrokToolOutputImage[] = []

  for (const rawItem of input) {
    const item = recordOf(rawItem)
    if (!item || !isGrokToolOutputItem(item)) {
      appendGrokToolOutputImageMessage(filtered, pendingImages)
      pendingImages = []
      filtered.push(rawItem)
      continue
    }

    const callId =
      stringValue(item.call_id) ||
      stringValue(item.tool_call_id) ||
      stringValue(item.id)
    if (!callId) {
      appendGrokToolOutputImageMessage(filtered, pendingImages)
      pendingImages = []
      filtered.push(rawItem)
      continue
    }

    const normalized = normalizeGrokToolOutput(
      firstDefined(item.output, item.content, item.results),
      callId,
    )
    filtered.push({ type: 'function_call_output', call_id: callId, output: normalized.output })
    pendingImages.push(...normalized.images)
    if (Array.isArray(item.images)) {
      for (const rawImage of item.images) {
        const url = grokToolOutputImageUrl(rawImage)
        if (url && !isEmptyBase64Image(url)) pendingImages.push({ callId, url })
      }
    }
  }

  appendGrokToolOutputImageMessage(filtered, pendingImages)
  return filtered
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
  if (Array.isArray(out.input)) out.input = sanitizeGrokResponsesInput(out.input)
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
