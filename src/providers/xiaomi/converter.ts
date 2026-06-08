/**
 * Converts an OpenAI Responses API request body (what Codex CLI sends) into
 * an OpenAI Chat Completions request body (what Xiaomi MiMo's upstream accepts
 * at https://api.xiaomimimo.com/v1/chat/completions).
 *
 * Codex sends:
 *   { model, instructions, input: string | InputItem[], tools?, stream, store, ... }
 *
 * MiMo accepts the Chat Completions shape:
 *   { model, messages: [{role, content, tool_calls?, tool_call_id?}], stream, tools?, ... }
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  reasoning_content?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
}

export interface ChatTool {
  type: 'function'
  function: { name: string; description?: string; parameters?: unknown }
}

export interface ChatCompletionsRequest {
  model: string
  messages: ChatMessage[]
  stream: boolean
  tools?: ChatTool[]
  tool_choice?: unknown
  temperature?: number
  top_p?: number
  max_tokens?: number
  frequency_penalty?: number
  presence_penalty?: number
  response_format?: unknown
}

/**
 * Codex defaults to model names like `gpt-5.5` which MiMo does not
 * recognise. Rewrite anything that doesn't already look like a MiMo model
 * to `mimo-v2.5-pro` (the coding/agentic flagship). Anything starting with
 * `mimo-` is passed through, so users can set `model="mimo-v2.5"` for the
 * cheaper multimodal variant in their Codex config.
 */
export function mapModel(input: unknown): string {
  if (typeof input !== 'string' || !input) return 'mimo-v2.5-pro'
  return input.startsWith('mimo-') ? input : 'mimo-v2.5-pro'
}

/** Fields on the Responses request that have no equivalent on chat/completions. */
const RESPONSES_DROP_TOPLEVEL = new Set([
  'input',
  'instructions',
  'store',
  'parallel_tool_calls',
  'previous_response_id',
  'reasoning',
  'truncation',
  'metadata',
  'service_tier',
  'background',
  'modalities',
  'text',
  'include',
  'max_output_tokens',
])

export function responsesToChatCompletions(
  body: Record<string, unknown>,
): ChatCompletionsRequest {
  const messages: ChatMessage[] = []

  const instructions = body.instructions
  if (typeof instructions === 'string' && instructions.trim()) {
    messages.push({ role: 'system', content: instructions })
  }

  const input = body.input
  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input })
  } else if (Array.isArray(input)) {
    const state = { pendingReasoning: '' }
    for (const item of input) convertInputItem(item, messages, state)
  }

  // MiMo thinking-mode "all-or-nothing" rule: if ANY assistant message in the
  // history carries `reasoning_content`, every other assistant message —
  // including tool-call-only ones — must carry it too, or the API rejects the
  // whole request with `reasoning_content ... must be passed back`. Codex CLI
  // sometimes drops the reasoning text on echo (older sessions, or when the
  // mb1: marker on `encrypted_content` was filtered out), which would leave a
  // mixed history. Backfill missing assistants with an empty string so the
  // request still validates.
  ensureUniformReasoningContent(messages)

  const tools = Array.isArray(body.tools)
    ? (body.tools as Array<Record<string, unknown>>)
        .map(convertTool)
        .filter((t): t is ChatTool => t !== null)
    : undefined

  const out: ChatCompletionsRequest = {
    model: mapModel(body.model),
    messages,
    stream: body.stream === true,
  }
  if (tools && tools.length) out.tools = tools
  if (body.tool_choice != null) out.tool_choice = body.tool_choice
  if (typeof body.temperature === 'number') out.temperature = body.temperature
  if (typeof body.top_p === 'number') out.top_p = body.top_p
  if (typeof body.max_output_tokens === 'number') out.max_tokens = body.max_output_tokens
  else if (typeof body.max_tokens === 'number') out.max_tokens = body.max_tokens
  if (typeof body.frequency_penalty === 'number') out.frequency_penalty = body.frequency_penalty
  if (typeof body.presence_penalty === 'number') out.presence_penalty = body.presence_penalty
  if (body.response_format != null) out.response_format = body.response_format

  return out
}

interface ConvertState {
  pendingReasoning: string
}

function convertInputItem(item: unknown, out: ChatMessage[], state: ConvertState): void {
  if (!item || typeof item !== 'object') return
  const it = item as Record<string, unknown>
  const type = typeof it.type === 'string' ? it.type : undefined

  if (type === 'reasoning') {
    // Buffer reasoning summary text; attach to the next assistant message
    // (MiMo thinking mode requires reasoning_content to be passed back).
    const summary = it.summary
    let captured = ''
    if (Array.isArray(summary)) {
      for (const part of summary) {
        if (!part || typeof part !== 'object') continue
        const p = part as Record<string, unknown>
        if (p.type === 'summary_text' && typeof p.text === 'string') {
          captured += p.text
        }
      }
    } else if (typeof it.content === 'string') {
      captured += it.content
    }
    // Codex CLI configured with `include: ['reasoning.encrypted_content']`
    // round-trips the reasoning item but often with an empty `summary` — the
    // text we need is in `encrypted_content`, which we previously stamped with
    // our `mb1:` marker in stream.ts.
    if (!captured && typeof it.encrypted_content === 'string') {
      captured = decodeReasoningMarker(it.encrypted_content)
    }
    state.pendingReasoning += captured
    return
  }

  if (type === 'function_call') {
    const toolCall = {
      id: String(it.call_id ?? it.id ?? ''),
      type: 'function' as const,
      function: {
        name: String(it.name ?? ''),
        arguments:
          typeof it.arguments === 'string'
            ? it.arguments
            : JSON.stringify(it.arguments ?? {}),
      },
    }
    // Merge consecutive function_calls into a single assistant message so the
    // tool messages can follow as a block (MiMo rejects an assistant
    // tool_calls message that isn't immediately followed by its tool replies).
    const last = out[out.length - 1]
    if (last && last.role === 'assistant' && last.tool_calls && last.content == null) {
      last.tool_calls.push(toolCall)
      if (state.pendingReasoning && !last.reasoning_content) {
        last.reasoning_content = state.pendingReasoning
      }
    } else {
      const msg: ChatMessage = { role: 'assistant', content: null, tool_calls: [toolCall] }
      if (state.pendingReasoning) msg.reasoning_content = state.pendingReasoning
      out.push(msg)
    }
    state.pendingReasoning = ''
    return
  }

  if (type === 'function_call_output') {
    const output = it.output
    out.push({
      role: 'tool',
      tool_call_id: String(it.call_id ?? ''),
      content: typeof output === 'string' ? output : JSON.stringify(output ?? ''),
    })
    state.pendingReasoning = ''
    return
  }

  // message-shaped item: {role, content:string|Array}
  const rawRole = typeof it.role === 'string' ? it.role : undefined
  if (!rawRole) return

  const role: ChatMessage['role'] =
    rawRole === 'developer'
      ? 'system'
      : rawRole === 'system' || rawRole === 'user' || rawRole === 'assistant'
        ? rawRole
        : 'user'

  const content = it.content
  let text = ''
  if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      const p = part as Record<string, unknown>
      if (
        (p.type === 'input_text' || p.type === 'output_text' || p.type === 'text') &&
        typeof p.text === 'string'
      ) {
        text += p.text
      }
      // input_image / image_url / file / etc. silently skipped — MiMo
      // chat/completions text path doesn't carry multimodal input here.
    }
  }
  const msg: ChatMessage = { role, content: text }
  if (role === 'assistant' && state.pendingReasoning) {
    msg.reasoning_content = state.pendingReasoning
  }
  state.pendingReasoning = ''
  out.push(msg)
}

function ensureUniformReasoningContent(messages: ChatMessage[]): void {
  const hasAny = messages.some(
    (m) => m.role === 'assistant' && typeof m.reasoning_content === 'string' && m.reasoning_content.length > 0,
  )
  if (!hasAny) return
  for (const m of messages) {
    if (m.role !== 'assistant') continue
    if (m.reasoning_content == null) m.reasoning_content = ''
  }
}

// Inverse of stream.ts `encodeReasoningMarker`. Anything that doesn't carry
// our prefix is treated as an opaque blob we can't decode (e.g. a real OpenAI
// encrypted reasoning token) and we return '' so the caller falls back to
// other sources.
function decodeReasoningMarker(raw: string): string {
  if (!raw.startsWith('mb1:')) return ''
  try {
    return Buffer.from(raw.slice(4), 'base64').toString('utf8')
  } catch {
    return ''
  }
}

function convertTool(tool: Record<string, unknown>): ChatTool | null {
  if (tool.type !== 'function') return null
  // Already in Chat Completions shape: {type:'function', function:{name,...}}
  if (tool.function && typeof tool.function === 'object') {
    const fn = tool.function as Record<string, unknown>
    if (typeof fn.name === 'string') return tool as unknown as ChatTool
  }
  // Responses shape: {type:'function', name, description, parameters}
  if (typeof tool.name === 'string') {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: typeof tool.description === 'string' ? tool.description : undefined,
        parameters: tool.parameters,
      },
    }
  }
  return null
}

// Re-exported only so tests can assert the set of dropped fields. Unused otherwise.
export const _DROPPED_FIELDS = RESPONSES_DROP_TOPLEVEL
