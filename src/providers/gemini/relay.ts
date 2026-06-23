const CODE_ASSIST_BASE = 'https://cloudcode-pa.googleapis.com/v1internal'

// JSON Schema fields the Gemini / Code Assist tool API rejects or ignores.
// Clients (e.g. Claude Code, some MCP tools) often emit these, causing 400s.
const UNSUPPORTED_SCHEMA_KEYS = new Set([
  '$schema',
  '$id',
  '$ref',
  '$defs',
  '$comment',
  'definitions',
  'additionalProperties',
  'unevaluatedProperties',
  'patternProperties',
  'title',
  'default',
  'examples',
  'nullable',
])

// Nested schema containers to recurse into. `properties` and `$defs`-like maps
// hold named sub-schemas; the rest hold a schema or an array of schemas.
const SCHEMA_MAP_KEYS = new Set(['properties'])
const SCHEMA_LIST_OR_NODE_KEYS = new Set(['items', 'anyOf', 'allOf', 'oneOf', 'prefixItems', 'not'])

/** Recursively strips Gemini-incompatible JSON Schema fields from a tool schema. */
function sanitizeSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeSchema)
  if (!value || typeof value !== 'object') return value
  const input = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(input)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) continue
    if (SCHEMA_MAP_KEYS.has(key) && val && typeof val === 'object' && !Array.isArray(val)) {
      const props: Record<string, unknown> = {}
      for (const [propName, propSchema] of Object.entries(val as Record<string, unknown>)) {
        props[propName] = sanitizeSchema(propSchema)
      }
      out[key] = props
    } else if (SCHEMA_LIST_OR_NODE_KEYS.has(key)) {
      out[key] = sanitizeSchema(val)
    } else {
      // Scalars (type, description, enum, required, format, …) pass through.
      out[key] = val
    }
  }
  return out
}

/**
 * Cleans tool/function-declaration JSON schemas in a Gemini request body so
 * fields the Code Assist backend rejects (e.g. `$schema`, `additionalProperties`)
 * don't 400 the request. Returns the body unchanged when it has no tools.
 * Operates on a shallow clone; the original body object is not mutated.
 */
export function sanitizeGeminiBody(body: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(body.tools)) return body
  const tools = body.tools.map((tool) => {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool)) return tool
    const t = tool as Record<string, unknown>
    if (!Array.isArray(t.functionDeclarations)) return tool
    const functionDeclarations = t.functionDeclarations.map((decl) => {
      if (!decl || typeof decl !== 'object' || Array.isArray(decl)) return decl
      const d = decl as Record<string, unknown>
      const next: Record<string, unknown> = { ...d }
      if (d.parameters && typeof d.parameters === 'object') {
        next.parameters = sanitizeSchema(d.parameters)
      }
      if (d.parametersJsonSchema && typeof d.parametersJsonSchema === 'object') {
        next.parametersJsonSchema = sanitizeSchema(d.parametersJsonSchema)
      }
      if (d.response && typeof d.response === 'object') {
        next.response = sanitizeSchema(d.response)
      }
      return next
    })
    return { ...t, functionDeclarations }
  })
  return { ...body, tools }
}

/** Builds the cloudcode-pa endpoint URL for a given client-requested action. */
function endpointFor(action: string): string {
  // Map standard Gemini API actions onto cloudcode-pa equivalents.
  // `:streamGenerateContent` needs `?alt=sse` for SSE framing.
  if (action === 'streamGenerateContent') {
    return `${CODE_ASSIST_BASE}:streamGenerateContent?alt=sse`
  }
  return `${CODE_ASSIST_BASE}:${action}`
}

/**
 * cloudcode-pa expects every request wrapped in
 *   { model, project, request: <standard Gemini request> }
 * and returns responses wrapped in `{ response: <standard chunk> }`.
 * We adapt both directions so the client sees the public Gemini API shape.
 */
function wrapRequest(
  model: string,
  project: string,
  body: Record<string, unknown>,
): Record<string, unknown> {
  return { model, project, request: body }
}

export interface GeminiRelayContext {
  model: string
  action: string
  project: string
}

export function relayGemini(
  accessToken: string,
  body: Record<string, unknown>,
  ctx: GeminiRelayContext,
): Promise<Response> {
  const cleaned = sanitizeGeminiBody(body)
  return fetch(endpointFor(ctx.action), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: ctx.action === 'streamGenerateContent' ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify(wrapRequest(ctx.model, ctx.project, cleaned)),
  })
}

/** Unwraps `{response: X}` to `X` for both SSE event payloads and full JSON bodies. */
export function unwrapResponseEnvelope(payload: unknown): unknown {
  if (payload && typeof payload === 'object' && 'response' in payload) {
    return (payload as { response: unknown }).response
  }
  return payload
}
