import { randomUUID } from 'node:crypto'
import { chatCompletionsToResponses } from './chat'
import { CODEX_ORIGINATOR, CODEX_USER_AGENT } from './constants'
import { fetchWithConnectTimeout } from '../../http/upstream'

const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'

// The Codex backend at /backend-api/codex/responses has known quirks:
//   - requires `stream: true`, `store: false`, and `instructions`
//   - 400s on `max_output_tokens` and `parallel_tool_calls`
// Reverse-engineered; update here if OpenAI changes the requirements.
const DEFAULT_INSTRUCTIONS = 'You are Codex, a helpful AI coding assistant.'
const FORBIDDEN_FIELDS = ['max_output_tokens', 'parallel_tool_calls'] as const
const IMAGE_GENERATION_TOOL_TYPE = 'image_generation'
const EMPTY_TOOL_PARAMETERS = { type: 'object', properties: {} }
const RESPONSES_ITEM_ID_PREFIXES = ['fc_', 'ctc_', 'ctco_', 'tsc_', 'tso_'] as const

const RESPONSES_ITEM_PREFIX_BY_TYPE: Record<string, string> = {
  function_call: 'fc_',
  custom_tool_call: 'ctc_',
  custom_tool_call_output: 'ctco_',
  tool_search_call: 'tsc_',
  tool_search_output: 'tso_',
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toolChoiceSelectsImageGeneration(choice: unknown): boolean {
  if (stringValue(choice) === IMAGE_GENERATION_TOOL_TYPE) return true
  if (!choice || typeof choice !== 'object' || Array.isArray(choice)) return false
  const row = choice as Record<string, unknown>
  const type = stringValue(row.type)
  if (type === IMAGE_GENERATION_TOOL_TYPE) return true
  if (type !== 'function') return false
  const name = stringValue(row.name)
  if (name === IMAGE_GENERATION_TOOL_TYPE) return true
  const fn = row.function
  return !!fn && typeof fn === 'object' && stringValue((fn as Record<string, unknown>).name) === IMAGE_GENERATION_TOOL_TYPE
}

function stripImageGenerationTools(body: Record<string, unknown>): void {
  const tools = body.tools
  if (Array.isArray(tools)) {
    const filtered = tools.filter((tool) => {
      if (!tool || typeof tool !== 'object' || Array.isArray(tool)) return true
      return stringValue((tool as Record<string, unknown>).type) !== IMAGE_GENERATION_TOOL_TYPE
    })
    if (filtered.length !== tools.length) {
      if (filtered.length) body.tools = filtered
      else delete body.tools
    }
  }
  if (toolChoiceSelectsImageGeneration(body.tool_choice)) delete body.tool_choice
}

function normalizeResponseTools(body: Record<string, unknown>): void {
  if (!Array.isArray(body.tools)) return
  body.tools = body.tools.map((tool) => {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool)) return tool
    const row = tool as Record<string, unknown>
    if (row.type !== 'function') return tool
    if (!row.parameters || typeof row.parameters !== 'object' || Array.isArray(row.parameters)) {
      return { ...row, parameters: EMPTY_TOOL_PARAMETERS }
    }

    // Some clients serialise an omitted JSON-schema type as `null`. The
    // Codex Responses endpoint rejects that shape with HTTP 400, so repair
    // only the missing/null type while preserving all other explicit schema
    // details and valid custom types.
    const parameters = row.parameters as Record<string, unknown>
    if (parameters.type == null) {
      return {
        ...row,
        parameters: { ...parameters, type: 'object' },
      }
    }
    return tool
  })
}

/**
 * Reconciles Responses item IDs after a client has round-tripped custom/tool
 * search calls through a function-compatible adapter. The Codex endpoint
 * validates the prefix against the item type (`fc_`, `ctc_`, `tsc_`, ...), so
 * retaining a known foreign prefix causes the next replay to fail with 400.
 * Unknown prefixes are left untouched rather than guessed at.
 */
function normalizeResponseInputItemIds(body: Record<string, unknown>): void {
  if (!Array.isArray(body.input)) return
  body.input = body.input.map((rawItem) => {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) return rawItem
    const item = rawItem as Record<string, unknown>
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    const expected = RESPONSES_ITEM_PREFIX_BY_TYPE[String(item.type ?? '')]
    if (!id || !expected || id.startsWith(expected)) return rawItem
    const known = RESPONSES_ITEM_ID_PREFIXES.find((prefix) => id.startsWith(prefix))
    if (!known) return rawItem
    return { ...item, id: `${expected}${id.slice(known.length)}` }
  })
}

/** Normalises an incoming Responses-API body to what the Codex backend accepts. */
export function normalizeOpenaiResponsesBody(
  body: Record<string, unknown>,
  options: { allowImageGeneration?: boolean } = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body }
  for (const field of FORBIDDEN_FIELDS) delete out[field]
  normalizeResponseTools(out)
  normalizeResponseInputItemIds(out)
  if (!options.allowImageGeneration) stripImageGenerationTools(out)
  if (typeof out.input === 'string') {
    out.input = [{ role: 'user', content: [{ type: 'input_text', text: out.input }] }]
  }
  out.stream = true
  out.store = false
  if (out.instructions == null || out.instructions === '') {
    out.instructions = DEFAULT_INSTRUCTIONS
  }
  return out
}

/** Relays a /v1/responses request to the Codex backend with a ChatGPT OAuth token. */
export function relayOpenaiResponses(
  accessToken: string,
  body: Record<string, unknown>,
  options: { allowImageGeneration?: boolean } = {},
): Promise<Response> {
  return fetchWithConnectTimeout(CODEX_RESPONSES_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'user-agent': CODEX_USER_AGENT,
      'openai-beta': 'responses=experimental',
      originator: CODEX_ORIGINATOR,
      session_id: randomUUID(),
    },
    body: JSON.stringify(normalizeOpenaiResponsesBody(body, options)),
  })
}

/** Relays a Responses request that intentionally uses the image_generation tool. */
export function relayOpenaiImageResponses(
  accessToken: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetchWithConnectTimeout(CODEX_RESPONSES_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'user-agent': CODEX_USER_AGENT,
      'openai-beta': 'responses=experimental',
      originator: CODEX_ORIGINATOR,
      session_id: randomUUID(),
    },
    body: JSON.stringify(normalizeOpenaiResponsesBody(body, { allowImageGeneration: true })),
  })
}

/** Relays a Chat Completions request through the same Responses-only backend. */
export function relayOpenaiChatCompletions(
  accessToken: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return relayOpenaiResponses(accessToken, chatCompletionsToResponses(body))
}
