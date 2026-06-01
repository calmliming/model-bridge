import { randomUUID } from 'node:crypto'
import { chatCompletionsToResponses } from './chat'

const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'

// Mimics the official Codex CLI so requests are not flagged as bot traffic.
const USER_AGENT = 'codex_cli_rs/0.20.0'

// The Codex backend at /backend-api/codex/responses has known quirks:
//   - requires `stream: true`, `store: false`, and `instructions`
//   - 400s on `max_output_tokens` and `parallel_tool_calls`
// Reverse-engineered; update here if OpenAI changes the requirements.
const DEFAULT_INSTRUCTIONS = 'You are Codex, a helpful AI coding assistant.'
const FORBIDDEN_FIELDS = ['max_output_tokens', 'parallel_tool_calls'] as const

/** Normalises an incoming Responses-API body to what the Codex backend accepts. */
function normalizeBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body }
  for (const field of FORBIDDEN_FIELDS) delete out[field]
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
): Promise<Response> {
  return fetch(CODEX_RESPONSES_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'user-agent': USER_AGENT,
      'openai-beta': 'responses=experimental',
      originator: 'codex_cli_rs',
      session_id: randomUUID(),
    },
    body: JSON.stringify(normalizeBody(body)),
  })
}

/** Relays a Chat Completions request through the same Responses-only backend. */
export function relayOpenaiChatCompletions(
  accessToken: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return relayOpenaiResponses(accessToken, chatCompletionsToResponses(body))
}
