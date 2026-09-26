import { expandLocalSchemaReferences } from './schema'
import { fetchWithConnectTimeout } from '../../http/upstream'

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
  // The Code Assist schema dialect accepts only a small JSON-Schema subset.
  // Length/cardinality constraints are valid JSON Schema but are rejected by
  // the Gemini compatibility endpoint (the same fields are stripped by the
  // upstream Sub2API compatibility layer).
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'exclusiveMinimum',
  'title',
  'default',
  'examples',
  'nullable',
  'deprecated',
])

// Nested schema containers to recurse into. `properties` and `$defs`-like maps
// hold named sub-schemas; the rest hold a schema or an array of schemas.
const SCHEMA_MAP_KEYS = new Set(['properties'])
const SCHEMA_LIST_OR_NODE_KEYS = new Set(['items', 'anyOf', 'allOf', 'oneOf', 'prefixItems', 'not'])

/**
 * Gemini enums are string-valued even when the incoming JSON Schema contains
 * scalar numbers/booleans. Keep scalar values losslessly as strings and drop
 * the enum when it contains a compound value that cannot be represented by
 * the Gemini dialect. This avoids an upstream 400 while preserving the
 * useful part of mixed scalar enums.
 */
function normalizeGeminiEnum(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return null
  const normalized: unknown[] = []
  for (const item of value) {
    if (typeof item === 'string') {
      normalized.push(item)
      continue
    }
    if (item === null || typeof item === 'boolean') {
      normalized.push(String(item))
      continue
    }
    if (typeof item === 'number' && Number.isFinite(item)) {
      normalized.push(String(item))
      continue
    }
    return null
  }
  return normalized
}

/** Recursively strips Gemini-incompatible JSON Schema fields from a tool schema. */
function cleanSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanSchema)
  if (!value || typeof value !== 'object') return value
  const input = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(input)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) continue
    if (key === 'required' && val === null) continue
    if (SCHEMA_MAP_KEYS.has(key) && val && typeof val === 'object' && !Array.isArray(val)) {
      const props: Record<string, unknown> = {}
      for (const [propName, propSchema] of Object.entries(val as Record<string, unknown>)) {
        props[propName] = cleanSchema(propSchema)
      }
      out[key] = props
    } else if (SCHEMA_LIST_OR_NODE_KEYS.has(key)) {
      out[key] = cleanSchema(val)
    } else {
      // Scalars (type, description, enum, required, format, …) pass through.
      out[key] = val
    }
  }
  // Gemini expects homogeneous items, not tuple keywords. Keep every tuple
  // member as an item alternative instead of arbitrarily narrowing to one.
  const tuple = Array.isArray(out.prefixItems) ? out.prefixItems : Array.isArray(out.items) ? out.items : null
  if (tuple) {
    const candidates = [...tuple]
    if (out.prefixItems && out.items && typeof out.items === 'object' && !Array.isArray(out.items)) candidates.push(out.items)
    const schemas = candidates.filter(item => item && typeof item === 'object' && !Array.isArray(item))
    const unique = [...new Map(schemas.map(item => [JSON.stringify(item), item])).values()]
    out.items = unique.length === 1 ? unique[0] : unique.length ? { anyOf: unique } : { type: 'string' }
    delete out.prefixItems
    out.type ??= 'array'
  }
  if (String(out.type).toLowerCase() === 'array' &&
      (!out.items || typeof out.items !== 'object' || Array.isArray(out.items) || !Object.keys(out.items).length)) {
    out.items = { type: 'string' }
  }
  if (Object.prototype.hasOwnProperty.call(out, 'enum')) {
    const normalized = normalizeGeminiEnum(out.enum)
    if (normalized) out.enum = normalized
    else delete out.enum
  }
  return out
}

function sanitizeSchema(value: unknown): unknown {
  return cleanSchema(expandLocalSchemaReferences(value))
}

/**
 * Cleans tool/function-declaration JSON schemas in a Gemini request body so
 * fields the Code Assist backend rejects (e.g. `$schema`, `additionalProperties`)
 * don't 400 the request. Gemini 3.7/3.8-specific generation settings are also
 * normalized when a model is supplied. The original body is not mutated.
 */
export function sanitizeGeminiBody(
  body: Record<string, unknown>,
  model = '',
): Record<string, unknown> {
  let cleaned = body
  if (Array.isArray(body.tools)) {
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
    cleaned = { ...body, tools }
  }

  // Gemini 3.7 and 3.8 Flash reject the legacy sampling/candidate fields and
  // the numeric thinking budget; 3.6 and earlier accept them. Omit the fields
  // so older clients use the model's supported default (`thinkingLevel:
  // medium`) instead of receiving a 400. 3.7 shipped with the same breaking
  // change as 3.8, so leaving it out here means every antigravity request with
  // thinking enabled 400s — that path synthesizes a numeric thinkingBudget
  // (antigravity/converter.ts) that only this strip removes.
  const normalizedModel = model.toLowerCase().replace(/^models\//, '')
  if (!/^gemini-3\.[78]-flash/.test(normalizedModel)) return cleaned
  const generationConfig = cleaned.generationConfig
  if (!generationConfig || typeof generationConfig !== 'object' || Array.isArray(generationConfig)) {
    return cleaned
  }

  const nextConfig = { ...(generationConfig as Record<string, unknown>) }
  let changed = false
  for (const key of ['temperature', 'topP', 'top_p', 'topK', 'top_k', 'candidateCount', 'candidate_count']) {
    if (key in nextConfig) {
      delete nextConfig[key]
      changed = true
    }
  }
  const thinkingConfig = nextConfig.thinkingConfig
  if (thinkingConfig && typeof thinkingConfig === 'object' && !Array.isArray(thinkingConfig)) {
    const nextThinking = { ...(thinkingConfig as Record<string, unknown>) }
    for (const key of ['thinkingBudget', 'thinking_budget']) {
      if (key in nextThinking) {
        delete nextThinking[key]
        changed = true
      }
    }
    if (changed) nextConfig.thinkingConfig = nextThinking
  }
  return changed ? { ...cleaned, generationConfig: nextConfig } : cleaned
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
  const cleaned = sanitizeGeminiBody(body, ctx.model)
  return fetchWithConnectTimeout(endpointFor(ctx.action), {
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
