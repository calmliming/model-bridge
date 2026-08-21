import { randomUUID } from 'node:crypto'
import { emptyUsage, usageWithCachedInput, type UsageData } from '../types'

interface ChatMessage {
  role?: string
  content?: unknown
  tool_call_id?: string
  tool_calls?: ChatToolCall[]
}

interface ChatTool {
  type?: string
  function?: {
    name?: string
    description?: string
    parameters?: unknown
  }
}

interface ChatToolCall {
  id?: string
  type?: string
  function?: {
    name?: string
    arguments?: string
  }
}

interface ResponsesUsage {
  input_tokens?: number
  output_tokens?: number
  input_tokens_details?: {
    cached_tokens?: number
    cache_write_tokens?: number
    cache_creation_tokens?: number
  }
  cached_tokens?: number
  cache_creation_tokens?: number
}

interface ResponsesStreamEvent {
  type?: string
  delta?: string
  item_id?: string
  output_index?: number
  item?: ResponsesOutputItem
  arguments?: string
  response?: {
    id?: string
    model?: string
    created_at?: number
    usage?: ResponsesUsage
    output?: ResponsesOutputItem[]
    error?: { message?: unknown; code?: unknown; type?: unknown }
    incomplete_details?: { reason?: unknown }
  }
}

interface ResponsesOutputItem {
  id?: string
  type?: string
  role?: string
  content?: unknown[]
  call_id?: string
  name?: string
  arguments?: string
}

interface ChatUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  prompt_tokens_details?: {
    cached_tokens: number
    cache_write_tokens?: number
    cache_creation_tokens?: number
  }
  completion_tokens_details?: { reasoning_tokens?: number }
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== 'object') return ''
        const p = part as Record<string, unknown>
        if (typeof p.text === 'string') return p.text
        if (typeof p.content === 'string') return p.content
        return ''
      })
      .join('')
  }
  if (content && typeof content === 'object') {
    const obj = content as { text?: unknown; content?: unknown }
    if (typeof obj.text === 'string') return obj.text
    if (typeof obj.content === 'string') return obj.content
  }
  return ''
}

/** Converts OpenAI Chat content blocks into Responses input content parts. */
function contentToResponsesParts(
  content: unknown,
  contentType: 'input_text' | 'output_text',
  includeImages: boolean,
): Array<Record<string, unknown>> {
  if (typeof content === 'string') return [{ type: contentType, text: content }]
  if (!Array.isArray(content)) return []

  const parts: Array<Record<string, unknown>> = []
  for (const rawPart of content) {
    if (!rawPart || typeof rawPart !== 'object') continue
    const part = rawPart as Record<string, unknown>
    const type = typeof part.type === 'string' ? part.type : ''

    if (type === 'text' || type === contentType) {
      if (typeof part.text === 'string') parts.push({ type: contentType, text: part.text })
      continue
    }

    if (!includeImages) continue

    if (type === 'image_url') {
      const image = part.image_url
      const imageUrl =
        typeof image === 'string'
          ? image
          : image && typeof image === 'object' && typeof (image as Record<string, unknown>).url === 'string'
            ? (image as Record<string, unknown>).url
            : null
      if (!imageUrl) continue
      const detail = image && typeof image === 'object' ? (image as Record<string, unknown>).detail : undefined
      parts.push({ type: 'input_image', image_url: imageUrl, ...(typeof detail === 'string' ? { detail } : {}) })
      continue
    }

    if (type === 'input_image') {
      const imageUrl = typeof part.image_url === 'string' ? part.image_url : undefined
      const fileId = typeof part.file_id === 'string' ? part.file_id : undefined
      if (imageUrl || fileId) {
        parts.push({
          type: 'input_image',
          ...(imageUrl ? { image_url: imageUrl } : {}),
          ...(fileId ? { file_id: fileId } : {}),
          ...(typeof part.detail === 'string' ? { detail: part.detail } : {}),
        })
      }
      continue
    }

    if (type === 'file') {
      const fileId = typeof part.file_id === 'string' ? part.file_id : undefined
      const fileData = typeof part.file_data === 'string' ? part.file_data : undefined
      if (fileId || fileData) {
        parts.push({ type: 'input_image', ...(fileId ? { file_id: fileId } : { image_url: fileData }) })
      }
    }
  }
  return parts
}

function convertChatToolCall(toolCall: ChatToolCall): Record<string, unknown> | null {
  if (toolCall.type !== 'function' || !toolCall.function?.name) return null
  return {
    type: 'function_call',
    call_id: toolCall.id ?? randomUUID(),
    name: toolCall.function.name,
    arguments: toolCall.function.arguments ?? '',
  }
}

function convertTool(tool: ChatTool): Record<string, unknown> | null {
  if (tool.type !== 'function' || !tool.function?.name) return null
  const parameters =
    tool.function.parameters && typeof tool.function.parameters === 'object'
      ? tool.function.parameters
      : { type: 'object', properties: {} }
  return {
    type: 'function',
    name: tool.function.name,
    description: tool.function.description,
    parameters,
  }
}

/**
 * Converts a standard OpenAI Chat Completions request into the Responses shape
 * accepted by the ChatGPT/Codex backend used by this relay.
 */
export function chatCompletionsToResponses(body: Record<string, unknown>): Record<string, unknown> {
  const messages = Array.isArray(body.messages) ? (body.messages as ChatMessage[]) : []
  const instructions: string[] = []
  const input: Array<Record<string, unknown>> = []

  for (const message of messages) {
    const role = typeof message.role === 'string' ? message.role : 'user'
    const text = contentToText(message.content)

    if (role === 'system' || role === 'developer') {
      if (!text) continue
      instructions.push(text)
      continue
    }

    if (role === 'tool') {
      if (!message.tool_call_id) continue
      input.push({
        type: 'function_call_output',
        call_id: message.tool_call_id,
        output: text,
      })
      continue
    }

    const responseRole = role === 'assistant' ? 'assistant' : 'user'
    const contentType = responseRole === 'assistant' ? 'output_text' : 'input_text'
    const contentParts = contentToResponsesParts(message.content, contentType, responseRole === 'user')
    if (contentParts.length) {
      input.push({
        role: responseRole,
        content: contentParts,
      })
    }

    if (role === 'assistant' && Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        const converted = convertChatToolCall(toolCall)
        if (converted) input.push(converted)
      }
    }
  }

  const out: Record<string, unknown> = {
    model: typeof body.model === 'string' ? body.model : '',
    input,
    stream: true,
    store: false,
  }

  if (instructions.length) out.instructions = instructions.join('\n\n')
  if (typeof body.temperature === 'number') out.temperature = body.temperature
  if (typeof body.top_p === 'number') out.top_p = body.top_p
  if (typeof body.max_completion_tokens === 'number') {
    out.max_output_tokens = body.max_completion_tokens
  } else if (typeof body.max_tokens === 'number') {
    out.max_output_tokens = body.max_tokens
  }
  if (body.tool_choice != null) out.tool_choice = body.tool_choice
  if (typeof body.user === 'string' && body.user) out.user = body.user
  if (typeof body.user_id === 'string' && body.user_id) out.user = body.user_id
  if (Array.isArray(body.tools)) {
    const tools = (body.tools as ChatTool[]).map(convertTool).filter((tool) => tool !== null)
    if (tools.length) out.tools = tools
  }

  return out
}

function usageDataFromResponses(usage: ResponsesUsage | undefined): UsageData {
  const d = usage?.input_tokens_details
  return usageWithCachedInput(
    usage?.input_tokens,
    usage?.output_tokens,
    d?.cached_tokens ?? usage?.cached_tokens,
    undefined,
    d?.cache_write_tokens ?? d?.cache_creation_tokens ?? usage?.cache_creation_tokens,
  )
}

function chatUsageFromResponses(usage: ResponsesUsage | undefined): ChatUsage | undefined {
  if (!usage) return undefined
  const prompt = usage.input_tokens ?? 0
  const completion = usage.output_tokens ?? 0
  const cached = usage.input_tokens_details?.cached_tokens ?? usage.cached_tokens ?? 0
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    ...(cached > 0 ? { prompt_tokens_details: { cached_tokens: cached } } : {}),
  }
}

export function parseChatCompletionUsage(body: unknown): UsageData {
  const usage = (body as { usage?: ChatUsage } | null)?.usage
  if (!usage) return emptyUsage()
  const d = usage.prompt_tokens_details
  return usageWithCachedInput(
    usage.prompt_tokens,
    usage.completion_tokens,
    d?.cached_tokens,
    usage.completion_tokens_details?.reasoning_tokens,
    d?.cache_write_tokens ?? d?.cache_creation_tokens,
  )
}

export function createChatCompletionStreamParser() {
  const usage = emptyUsage()
  return {
    feed(event: unknown): void {
      const parsed = parseChatCompletionUsage(event)
      if (
        parsed.inputTokens ||
        parsed.outputTokens ||
        parsed.cacheCreateTokens ||
        parsed.cacheReadTokens
      ) {
        Object.assign(usage, parsed)
      }
    },
    result(): UsageData {
      return { ...usage }
    },
  }
}

/**
 * Builds a minimal but valid OpenAI Responses-API error event sequence
 * (`response.created` → `response.in_progress` → `response.failed`). The Codex
 * CLI requires every SSE stream to end with a terminal event; when the upstream
 * errored or dropped before sending one, the relay emits this so Codex surfaces
 * the real failure instead of reconnecting forever.
 */
export function buildResponsesErrorEvents(message: string, code: string): unknown[] {
  const id = `resp_${randomUUID().replace(/-/g, '')}`
  const created = Math.floor(Date.now() / 1000)
  const base = {
    id,
    object: 'response',
    created_at: created,
    model: '',
    output: [] as unknown[],
    parallel_tool_calls: false,
    tool_choice: 'auto',
    tools: [] as unknown[],
  }
  return [
    { type: 'response.created', sequence_number: 0, response: { ...base, status: 'in_progress' } },
    { type: 'response.in_progress', sequence_number: 1, response: { ...base, status: 'in_progress' } },
    {
      type: 'response.failed',
      sequence_number: 2,
      response: { ...base, status: 'failed', error: { code, message } },
    },
  ]
}

export function parseResponsesSseEvents(text: string): unknown[] {
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
      // Ignore non-JSON data frames.
    }
  }
  return events
}

function textFromOutputItems(output: ResponsesOutputItem[] | undefined): string {
  const chunks: string[] = []
  for (const item of output ?? []) {
    const content = item.content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      const p = part as { text?: unknown }
      if (typeof p.text === 'string') chunks.push(p.text)
    }
  }
  return chunks.join('')
}

function toolCallsFromOutputItems(output: ResponsesOutputItem[] | undefined): ChatToolCall[] {
  const calls: ChatToolCall[] = []
  for (const item of output ?? []) {
    if (item?.type !== 'function_call' || !item.name) continue
    calls.push({
      id: item.call_id ?? item.id ?? randomUUID(),
      type: 'function',
      function: {
        name: item.name,
        arguments: item.arguments ?? '',
      },
    })
  }
  return calls
}

/**
 * Maps a Responses `incomplete_details.reason` to an OpenAI finish_reason, or
 * null when the reason has no Chat Completions equivalent.
 */
function finishReasonFromIncomplete(reason: unknown): 'length' | 'content_filter' | null {
  if (reason === 'max_output_tokens' || reason === 'max_tokens') return 'length'
  if (reason === 'content_filter') return 'content_filter'
  return null
}

export function responsesSseToChatCompletion(
  text: string,
  fallbackModel: string,
): { body: Record<string, unknown>; usage: UsageData; status?: 'error' } {
  const id = `chatcmpl-${randomUUID()}`
  let upstreamId = id
  let model = fallbackModel
  let created = Math.floor(Date.now() / 1000)
  let content = ''
  let output: ResponsesOutputItem[] | undefined
  let rawUsage: ResponsesUsage | undefined
  let failure: { code: string; message: string } | undefined
  let incompleteFinish: 'length' | 'content_filter' | null = null

  for (const event of parseResponsesSseEvents(text)) {
    const e = event as ResponsesStreamEvent
    if (e.response?.id) upstreamId = e.response.id
    if (e.response?.model) model = e.response.model
    if (typeof e.response?.created_at === 'number') created = e.response.created_at
    if (e.type === 'response.output_text.delta' && typeof e.delta === 'string') {
      content += e.delta
    }
    if (e.type === 'response.completed' && e.response) {
      rawUsage = e.response.usage
      output = e.response.output
      if (!content) content = textFromOutputItems(e.response.output)
    }
    // A mid-stream terminal failure (upstream sent 200 then failed/incomplete).
    // Capture it so we don't return an empty, successful-looking completion.
    if (e.type === 'response.failed' || e.type === 'response.incomplete') {
      if (e.response?.usage) rawUsage = e.response.usage
      if (e.type === 'response.incomplete') {
        // Truncation with usable content isn't an error: it becomes a normal
        // completion whose finish_reason says why it stopped (length / filter).
        if (!output && e.response?.output) output = e.response.output
        if (!content) content = textFromOutputItems(e.response?.output)
        incompleteFinish = finishReasonFromIncomplete(e.response?.incomplete_details?.reason)
      }
      const err = e.response?.error
      const message =
        typeof err?.message === 'string' && err.message
          ? err.message
          : e.type === 'response.failed'
            ? 'Upstream response failed.'
            : 'Upstream response incomplete.'
      const rawCode = err?.code ?? err?.type
      failure = { code: typeof rawCode === 'string' && rawCode ? rawCode : e.type, message }
    }
  }

  const chatUsage = chatUsageFromResponses(rawUsage)
  const toolCalls = toolCallsFromOutputItems(output)
  const hasToolCalls = toolCalls.length > 0

  // Failure with no usable content/tool output: surface an OpenAI-style error
  // body instead of a hollow success, and flag the usage record as an error.
  if (failure && !content && !hasToolCalls) {
    return {
      body: { error: { message: failure.message, type: failure.code, code: failure.code } },
      usage: usageDataFromResponses(rawUsage),
      status: 'error',
    }
  }

  return {
    body: {
      id: upstreamId,
      object: 'chat.completion',
      created,
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: hasToolCalls && !content ? null : content,
            ...(hasToolCalls ? { tool_calls: toolCalls } : {}),
          },
          finish_reason: hasToolCalls ? 'tool_calls' : (incompleteFinish ?? 'stop'),
        },
      ],
      ...(chatUsage ? { usage: chatUsage } : {}),
    },
    usage: usageDataFromResponses(rawUsage),
  }
}

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

export function createOpenaiChatCompletionsStreamTransform(): {
  transform(data: unknown): unknown[]
  flush(): unknown[]
} {
  const state = {
    id: `chatcmpl-${randomUUID()}`,
    created: Math.floor(Date.now() / 1000),
    model: '',
    sentRole: false,
    completed: false,
    toolIndex: 0,
    hasToolCalls: false,
    toolIndexesByItemId: new Map<string, number>(),
  }

  function roleDelta(delta: Record<string, unknown>): Record<string, unknown> {
    if (!state.sentRole) {
      delta.role = 'assistant'
      state.sentRole = true
    }
    return delta
  }

  return {
    transform(data: unknown): unknown[] {
      const event = data as ResponsesStreamEvent
      if (event.response?.id) state.id = event.response.id
      if (event.response?.model) state.model = event.response.model
      if (typeof event.response?.created_at === 'number') state.created = event.response.created_at

      if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
        return [chatChunk(state.id, state.created, state.model, roleDelta({ content: event.delta }), null)]
      }

      if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
        state.hasToolCalls = true
        const itemId = event.item.id ?? event.item_id ?? randomUUID()
        const index = state.toolIndex++
        state.toolIndexesByItemId.set(itemId, index)
        const toolCall: Record<string, unknown> = {
          index,
          id: event.item.call_id ?? itemId,
          type: 'function',
          function: {
            name: event.item.name ?? '',
            arguments: event.item.arguments ?? '',
          },
        }
        return [
          chatChunk(
            state.id,
            state.created,
            state.model,
            roleDelta({ tool_calls: [toolCall] }),
            null,
          ),
        ]
      }

      if (
        event.type === 'response.function_call_arguments.delta' &&
        typeof event.delta === 'string'
      ) {
        const itemId = event.item_id ?? ''
        const index = state.toolIndexesByItemId.get(itemId)
        if (index == null) return []
        return [
          chatChunk(
            state.id,
            state.created,
            state.model,
            { tool_calls: [{ index, function: { arguments: event.delta } }] },
            null,
          ),
        ]
      }

      if (event.type === 'response.completed') {
        state.completed = true
        const output = event.response?.output ?? []
        const hasToolCalls = state.hasToolCalls || toolCallsFromOutputItems(output).length > 0
        const delta = state.sentRole ? {} : { role: 'assistant' }
        return [chatChunk(state.id, state.created, state.model, delta, hasToolCalls ? 'tool_calls' : 'stop'), '[DONE]']
      }

      // Truncated-but-usable terminal: finish with the mapped reason (length /
      // content_filter) instead of letting flush() fake a clean 'stop'.
      if (event.type === 'response.incomplete') {
        state.completed = true
        const finish =
          finishReasonFromIncomplete(event.response?.incomplete_details?.reason) ?? 'stop'
        const delta = state.sentRole ? {} : { role: 'assistant' }
        return [chatChunk(state.id, state.created, state.model, delta, finish), '[DONE]']
      }

      // Mid-stream terminal failure (upstream sent 200 then failed). Surface it
      // as an OpenAI-style error chunk and terminate, instead of silently
      // ending with an empty, successful-looking finish.
      if (event.type === 'response.failed') {
        state.completed = true
        const err = event.response?.error
        const message =
          typeof err?.message === 'string' && err.message
            ? err.message
            : 'Upstream response failed.'
        const rawCode = err?.code ?? err?.type
        const code = typeof rawCode === 'string' && rawCode ? rawCode : 'response.failed'
        return [{ error: { message, type: code, code } }, '[DONE]']
      }

      return []
    },
    flush(): unknown[] {
      if (state.completed) return []
      const delta = state.sentRole ? {} : { role: 'assistant' }
      state.completed = true
      return [chatChunk(state.id, state.created, state.model, delta, 'stop'), '[DONE]']
    },
  }
}
