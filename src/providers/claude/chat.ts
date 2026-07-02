/**
 * OpenAI Chat Completions ⇄ Anthropic Messages semantic conversion.
 *
 * Lets an OpenAI-format client (OpenAI SDK, LangChain, etc.) talk to a Claude
 * subscription upstream: the request is translated Chat Completions → Messages,
 * and the response is translated back Messages → Chat Completions, for both the
 * buffered JSON path and the streamed SSE path.
 *
 * Only text and tool-calling are translated; image parts and other multimodal
 * content are dropped (Claude Code subscription traffic is overwhelmingly text
 * + tools). The reverse direction (Anthropic client → OpenAI upstream) is not
 * implemented here.
 */

import { randomUUID } from 'node:crypto'
import { emptyUsage, type UsageData } from '../types'

/** Anthropic requires max_tokens; use this when the client omits it. */
const DEFAULT_MAX_TOKENS = 4096

// ── Request: Chat Completions → Anthropic Messages ──────────────────────────

interface ChatToolCall {
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

interface ChatMessage {
  role?: string
  content?: unknown
  tool_calls?: ChatToolCall[]
  tool_call_id?: string
  name?: string
}

type AnthropicBlock = Record<string, unknown>
interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: AnthropicBlock[]
}

/** Flattens OpenAI message content (string, or an array of parts) to plain text. */
function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
          return (part as { text: string }).text
        }
        return ''
      })
      .join('')
  }
  return ''
}

function safeJsonParse(raw: string | undefined): unknown {
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

/** Maps OpenAI tool definitions to Anthropic tool definitions. */
function convertTools(tools: unknown): AnthropicBlock[] | undefined {
  if (!Array.isArray(tools)) return undefined
  const out: AnthropicBlock[] = []
  for (const tool of tools as Array<{ type?: string; function?: { name?: string; description?: string; parameters?: unknown } }>) {
    if (tool?.type !== 'function' || !tool.function?.name) continue
    out.push({
      name: tool.function.name,
      ...(tool.function.description ? { description: tool.function.description } : {}),
      input_schema: tool.function.parameters ?? { type: 'object', properties: {} },
    })
  }
  return out.length ? out : undefined
}

/** Maps OpenAI tool_choice to Anthropic tool_choice. Returns undefined to omit. */
function convertToolChoice(choice: unknown): AnthropicBlock | undefined {
  if (choice === 'auto') return { type: 'auto' }
  if (choice === 'required') return { type: 'any' }
  if (choice === 'none') return undefined
  if (choice && typeof choice === 'object') {
    const fn = (choice as { function?: { name?: string } }).function
    if (fn?.name) return { type: 'tool', name: fn.name }
  }
  return undefined
}

/**
 * Converts an OpenAI Chat Completions request body into an Anthropic Messages
 * request body. System/developer turns are hoisted into `system`; assistant
 * tool_calls become `tool_use` blocks; `tool` results become `tool_result`
 * blocks folded into the preceding user turn. Consecutive same-role turns are
 * merged so the result always alternates user/assistant as Anthropic requires.
 */
export function chatCompletionsToClaudeMessages(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const messages = Array.isArray(body.messages) ? (body.messages as ChatMessage[]) : []
  const systemParts: string[] = []
  const anthMessages: AnthropicMessage[] = []

  const push = (role: 'user' | 'assistant', blocks: AnthropicBlock[]): void => {
    if (!blocks.length) return
    const last = anthMessages[anthMessages.length - 1]
    if (last && last.role === role) last.content.push(...blocks)
    else anthMessages.push({ role, content: blocks })
  }

  for (const msg of messages) {
    const role = msg.role
    if (role === 'system' || role === 'developer') {
      const text = contentToText(msg.content)
      if (text) systemParts.push(text)
      continue
    }
    if (role === 'tool') {
      // A tool result belongs in a user turn as a tool_result block.
      push('user', [
        {
          type: 'tool_result',
          tool_use_id: msg.tool_call_id ?? '',
          content: contentToText(msg.content),
        },
      ])
      continue
    }
    if (role === 'assistant') {
      const blocks: AnthropicBlock[] = []
      const text = contentToText(msg.content)
      if (text) blocks.push({ type: 'text', text })
      for (const call of msg.tool_calls ?? []) {
        if (call?.type && call.type !== 'function') continue
        blocks.push({
          type: 'tool_use',
          id: call.id ?? `toolu_${randomUUID().replace(/-/g, '')}`,
          name: call.function?.name ?? '',
          input: safeJsonParse(call.function?.arguments),
        })
      }
      push('assistant', blocks)
      continue
    }
    // Default: treat as a user turn.
    push('user', [{ type: 'text', text: contentToText(msg.content) }])
  }

  const out: Record<string, unknown> = {
    model: typeof body.model === 'string' ? body.model : '',
    max_tokens:
      typeof body.max_tokens === 'number'
        ? body.max_tokens
        : typeof body.max_completion_tokens === 'number'
          ? body.max_completion_tokens
          : DEFAULT_MAX_TOKENS,
    messages: anthMessages,
    stream: body.stream === true,
  }
  if (systemParts.length) out.system = systemParts.join('\n\n')
  const tools = convertTools(body.tools)
  if (tools) out.tools = tools
  const toolChoice = convertToolChoice(body.tool_choice)
  if (toolChoice) out.tool_choice = toolChoice
  if (typeof body.temperature === 'number') out.temperature = body.temperature
  if (typeof body.top_p === 'number') out.top_p = body.top_p
  if (typeof body.stop === 'string') out.stop_sequences = [body.stop]
  else if (Array.isArray(body.stop)) out.stop_sequences = body.stop
  return out
}

// ── Response: Anthropic Messages → Chat Completions ─────────────────────────

/** Maps an Anthropic stop_reason to an OpenAI finish_reason. */
export function mapStopReason(stopReason: unknown): 'stop' | 'length' | 'tool_calls' {
  switch (stopReason) {
    case 'tool_use':
      return 'tool_calls'
    case 'max_tokens':
      return 'length'
    default:
      return 'stop' // end_turn, stop_sequence, null
  }
}

interface AnthropicContentBlock {
  type?: string
  text?: string
  id?: string
  name?: string
  input?: unknown
}

interface OpenAIToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface AnthropicUsage {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

function usageFromAnthropic(u: AnthropicUsage | undefined): UsageData {
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    reasoningTokens: 0,
    cacheCreateTokens: u?.cache_creation_input_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
  }
}

function chatUsageFromAnthropic(u: AnthropicUsage | undefined):
  | { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  | undefined {
  if (!u) return undefined
  const prompt = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
  const completion = u.output_tokens ?? 0
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion }
}

/** Converts a non-streaming Anthropic Messages JSON body to a Chat Completion. */
export function claudeMessageToChatCompletion(
  json: unknown,
  fallbackModel: string,
): { body: Record<string, unknown>; usage: UsageData } {
  const msg = json as {
    id?: string
    model?: string
    content?: AnthropicContentBlock[]
    stop_reason?: unknown
    usage?: AnthropicUsage
  } | null
  let text = ''
  const toolCalls: OpenAIToolCall[] = []
  for (const block of msg?.content ?? []) {
    if (block?.type === 'text' && typeof block.text === 'string') text += block.text
    else if (block?.type === 'tool_use') {
      toolCalls.push({
        id: block.id ?? `call_${randomUUID().replace(/-/g, '')}`,
        type: 'function',
        function: { name: block.name ?? '', arguments: JSON.stringify(block.input ?? {}) },
      })
    }
  }
  const hasToolCalls = toolCalls.length > 0
  const chatUsage = chatUsageFromAnthropic(msg?.usage)
  return {
    body: {
      id: msg?.id ?? `chatcmpl-${randomUUID()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: msg?.model ?? fallbackModel,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: hasToolCalls && !text ? null : text,
            ...(hasToolCalls ? { tool_calls: toolCalls } : {}),
          },
          finish_reason: hasToolCalls ? 'tool_calls' : mapStopReason(msg?.stop_reason),
        },
      ],
      ...(chatUsage ? { usage: chatUsage } : {}),
    },
    usage: usageFromAnthropic(msg?.usage),
  }
}

// ── Streaming: Anthropic SSE → chat.completion.chunk ────────────────────────

function chatChunk(
  id: string,
  created: number,
  model: string,
  delta: Record<string, unknown>,
  finishReason: string | null,
): Record<string, unknown> {
  return {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  }
}

interface AnthropicStreamEvent {
  type?: string
  message?: { id?: string; model?: string }
  index?: number
  content_block?: AnthropicContentBlock
  delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: unknown }
}

/**
 * Stateful transform: Anthropic Messages SSE events → OpenAI
 * chat.completion.chunk events, ending with a finish chunk and `[DONE]`.
 * Maps Anthropic content-block indexes to OpenAI tool_call indexes so
 * input_json_delta fragments attach to the right call.
 */
export function createClaudeChatCompletionsStreamTransform(): {
  transform(data: unknown): unknown[]
  flush(): unknown[]
} {
  const state = {
    id: `chatcmpl-${randomUUID()}`,
    created: Math.floor(Date.now() / 1000),
    model: '',
    sentRole: false,
    completed: false,
    finishReason: 'stop' as string,
    nextToolIndex: 0,
    // Anthropic content-block index → OpenAI tool_call index (tool_use only).
    toolIndexByBlock: new Map<number, number>(),
  }

  const roleDelta = (delta: Record<string, unknown>): Record<string, unknown> => {
    if (!state.sentRole) {
      delta.role = 'assistant'
      state.sentRole = true
    }
    return delta
  }

  return {
    transform(data: unknown): unknown[] {
      const e = data as AnthropicStreamEvent
      switch (e.type) {
        case 'message_start':
          if (e.message?.model) state.model = e.message.model
          return []
        case 'content_block_start': {
          const cb = e.content_block
          if (cb?.type === 'tool_use' && typeof e.index === 'number') {
            const toolIndex = state.nextToolIndex++
            state.toolIndexByBlock.set(e.index, toolIndex)
            return [
              chatChunk(
                state.id,
                state.created,
                state.model,
                roleDelta({
                  tool_calls: [
                    {
                      index: toolIndex,
                      id: cb.id ?? `call_${randomUUID().replace(/-/g, '')}`,
                      type: 'function',
                      function: { name: cb.name ?? '', arguments: '' },
                    },
                  ],
                }),
                null,
              ),
            ]
          }
          return []
        }
        case 'content_block_delta': {
          if (e.delta?.type === 'text_delta' && typeof e.delta.text === 'string') {
            return [
              chatChunk(state.id, state.created, state.model, roleDelta({ content: e.delta.text }), null),
            ]
          }
          if (e.delta?.type === 'input_json_delta' && typeof e.delta.partial_json === 'string') {
            const toolIndex = typeof e.index === 'number' ? state.toolIndexByBlock.get(e.index) : undefined
            if (toolIndex == null) return []
            return [
              chatChunk(
                state.id,
                state.created,
                state.model,
                { tool_calls: [{ index: toolIndex, function: { arguments: e.delta.partial_json } }] },
                null,
              ),
            ]
          }
          return []
        }
        case 'message_delta':
          if (e.delta?.stop_reason != null) state.finishReason = mapStopReason(e.delta.stop_reason)
          return []
        case 'message_stop': {
          if (state.completed) return []
          state.completed = true
          return [
            chatChunk(state.id, state.created, state.model, {}, state.finishReason),
            '[DONE]',
          ]
        }
        default:
          return []
      }
    },
    flush(): unknown[] {
      if (state.completed) return []
      state.completed = true
      const delta = state.sentRole ? {} : { role: 'assistant' }
      return [chatChunk(state.id, state.created, state.model, delta, state.finishReason), '[DONE]']
    },
  }
}

/** Parses raw Anthropic SSE text into an array of decoded `data:` JSON events. */
export function parseAnthropicSseEvents(text: string): unknown[] {
  const events: unknown[] = []
  for (const block of text.split(/\r?\n\r?\n/)) {
    const payload = block
      .split(/\r?\n/)
      .map((line) => line.trimStart())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n')
    if (!payload || payload === '[DONE]') continue
    try {
      events.push(JSON.parse(payload))
    } catch {
      // Ignore non-JSON frames.
    }
  }
  return events
}

/**
 * Buffers a streamed Anthropic response (SSE text) into a single Chat
 * Completion JSON body — used for non-streaming clients when the upstream was
 * asked to stream (forceStream).
 */
export function claudeSseToChatCompletion(
  text: string,
  fallbackModel: string,
): { body: Record<string, unknown>; usage: UsageData } {
  let id = `chatcmpl-${randomUUID()}`
  let model = fallbackModel
  let content = ''
  let stopReason: unknown = null
  const toolByBlock = new Map<number, { id: string; name: string; args: string }>()
  const usage: AnthropicUsage = {}

  for (const event of parseAnthropicSseEvents(text)) {
    const e = event as AnthropicStreamEvent & {
      message?: { id?: string; model?: string; usage?: AnthropicUsage }
      content_block?: AnthropicContentBlock
      usage?: AnthropicUsage
    }
    switch (e.type) {
      case 'message_start':
        if (e.message?.id) id = e.message.id
        if (e.message?.model) model = e.message.model
        if (e.message?.usage) Object.assign(usage, e.message.usage)
        break
      case 'content_block_start':
        if (e.content_block?.type === 'tool_use' && typeof e.index === 'number') {
          toolByBlock.set(e.index, {
            id: e.content_block.id ?? `call_${randomUUID().replace(/-/g, '')}`,
            name: e.content_block.name ?? '',
            args: '',
          })
        }
        break
      case 'content_block_delta':
        if (e.delta?.type === 'text_delta' && typeof e.delta.text === 'string') {
          content += e.delta.text
        } else if (
          e.delta?.type === 'input_json_delta' &&
          typeof e.delta.partial_json === 'string' &&
          typeof e.index === 'number'
        ) {
          const tool = toolByBlock.get(e.index)
          if (tool) tool.args += e.delta.partial_json
        }
        break
      case 'message_delta':
        if (e.delta?.stop_reason != null) stopReason = e.delta.stop_reason
        if (e.usage) Object.assign(usage, e.usage)
        break
      default:
        break
    }
  }

  const toolCalls: OpenAIToolCall[] = [...toolByBlock.values()].map((t) => ({
    id: t.id,
    type: 'function',
    function: { name: t.name, arguments: t.args || '{}' },
  }))
  const hasToolCalls = toolCalls.length > 0
  const chatUsage = chatUsageFromAnthropic(usage)
  return {
    body: {
      id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: hasToolCalls && !content ? null : content,
            ...(hasToolCalls ? { tool_calls: toolCalls } : {}),
          },
          finish_reason: hasToolCalls ? 'tool_calls' : mapStopReason(stopReason),
        },
      ],
      ...(chatUsage ? { usage: chatUsage } : {}),
    },
    usage: usageFromAnthropic(usage),
  }
}

/** Non-stream usage parser for the buffered JSON path (Anthropic Messages body). */
export function parseClaudeChatJsonUsage(body: unknown): UsageData {
  const usage = (body as { usage?: AnthropicUsage } | null | undefined)?.usage
  if (!usage) return emptyUsage()
  return usageFromAnthropic(usage)
}
