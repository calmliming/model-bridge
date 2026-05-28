import { randomBytes } from 'node:crypto'

/**
 * Converts an OpenAI Chat Completions SSE stream (what DeepSeek sends back
 * from /v1/chat/completions) into an OpenAI Responses-API SSE event stream
 * (what Codex CLI expects on /v1/responses).
 *
 * The mapping is one-chunk-to-many-events plus per-stream state, so this is
 * exposed as a factory returning a stateful object that the relay calls per
 * upstream event and once at flush.
 */

interface ChatToolCallDelta {
  index: number
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

interface ChatDelta {
  role?: string
  content?: string | null
  reasoning_content?: string | null
  tool_calls?: ChatToolCallDelta[]
}

interface ChatChoice {
  index?: number
  delta?: ChatDelta
  finish_reason?: string | null
}

interface ChatUsage {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_cache_hit_tokens?: number
  prompt_cache_miss_tokens?: number
}

interface ChatChunk {
  id?: string
  model?: string
  created?: number
  choices?: ChatChoice[]
  usage?: ChatUsage | null
}

interface ToolCallBucket {
  itemId: string
  outputIndex: number
  callId: string
  name: string
  argsBuffer: string
  addedEmitted: boolean
}

interface StreamState {
  responseId: string
  model: string
  createdAt: number
  sequenceNumber: number
  startedEmitted: boolean
  outputIndex: number

  messageItemId: string | null
  messageOutputIndex: number
  contentIndex: number
  textBuffer: string

  reasoningItemId: string | null
  reasoningOutputIndex: number
  reasoningBuffer: string
  reasoningPartOpened: boolean

  toolCalls: Map<number, ToolCallBucket>
  toolCallOrder: number[]

  finishReason: string | null
  usage: ChatUsage | null
}

export interface StreamTransform {
  transform(data: unknown): unknown[]
  flush(): unknown[]
}

function shortId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`
}

function nextSeq(s: StreamState): number {
  return s.sequenceNumber++
}

function mapUsageToResponses(u: ChatUsage | null) {
  return {
    input_tokens: u?.prompt_tokens ?? 0,
    output_tokens: u?.completion_tokens ?? 0,
    input_tokens_details: { cached_tokens: u?.prompt_cache_hit_tokens ?? 0 },
  }
}

function stubResponse(s: StreamState, status: 'in_progress' | 'completed' | 'failed') {
  return {
    id: s.responseId,
    object: 'response',
    created_at: s.createdAt,
    status,
    model: s.model,
    output: [] as unknown[],
    parallel_tool_calls: false,
    tool_choice: 'auto',
    tools: [] as unknown[],
  }
}

function buildFinalOutput(s: StreamState): unknown[] {
  const items: unknown[] = []
  if (s.reasoningItemId) {
    items.push({
      id: s.reasoningItemId,
      type: 'reasoning',
      summary: [{ type: 'summary_text', text: s.reasoningBuffer }],
    })
  }
  if (s.messageItemId) {
    items.push({
      id: s.messageItemId,
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: s.textBuffer, annotations: [] }],
    })
  }
  for (const idx of s.toolCallOrder) {
    const b = s.toolCalls.get(idx)
    if (!b) continue
    items.push({
      id: b.itemId,
      type: 'function_call',
      status: 'completed',
      call_id: b.callId,
      name: b.name,
      arguments: b.argsBuffer,
    })
  }
  return items
}

function openReasoning(s: StreamState, out: unknown[]): void {
  s.reasoningItemId = shortId('rs')
  s.reasoningOutputIndex = s.outputIndex++
  s.reasoningPartOpened = true
  out.push({
    type: 'response.output_item.added',
    sequence_number: nextSeq(s),
    output_index: s.reasoningOutputIndex,
    item: {
      id: s.reasoningItemId,
      type: 'reasoning',
      summary: [],
    },
  })
  out.push({
    type: 'response.reasoning_summary_part.added',
    sequence_number: nextSeq(s),
    item_id: s.reasoningItemId,
    output_index: s.reasoningOutputIndex,
    summary_index: 0,
    part: { type: 'summary_text', text: '' },
  })
}

function closeReasoning(s: StreamState, out: unknown[]): void {
  if (!s.reasoningItemId || !s.reasoningPartOpened) return
  out.push({
    type: 'response.reasoning_summary_text.done',
    sequence_number: nextSeq(s),
    item_id: s.reasoningItemId,
    output_index: s.reasoningOutputIndex,
    summary_index: 0,
    text: s.reasoningBuffer,
  })
  out.push({
    type: 'response.reasoning_summary_part.done',
    sequence_number: nextSeq(s),
    item_id: s.reasoningItemId,
    output_index: s.reasoningOutputIndex,
    summary_index: 0,
    part: { type: 'summary_text', text: s.reasoningBuffer },
  })
  out.push({
    type: 'response.output_item.done',
    sequence_number: nextSeq(s),
    output_index: s.reasoningOutputIndex,
    item: {
      id: s.reasoningItemId,
      type: 'reasoning',
      summary: [{ type: 'summary_text', text: s.reasoningBuffer }],
    },
  })
  s.reasoningPartOpened = false
}

function openMessage(s: StreamState, out: unknown[]): void {
  s.messageItemId = shortId('msg')
  s.messageOutputIndex = s.outputIndex++
  s.contentIndex = 0
  out.push({
    type: 'response.output_item.added',
    sequence_number: nextSeq(s),
    output_index: s.messageOutputIndex,
    item: {
      id: s.messageItemId,
      type: 'message',
      status: 'in_progress',
      role: 'assistant',
      content: [],
    },
  })
  out.push({
    type: 'response.content_part.added',
    sequence_number: nextSeq(s),
    item_id: s.messageItemId,
    output_index: s.messageOutputIndex,
    content_index: s.contentIndex,
    part: { type: 'output_text', text: '', annotations: [] },
  })
}

function closeMessage(s: StreamState, out: unknown[]): void {
  if (!s.messageItemId) return
  out.push({
    type: 'response.output_text.done',
    sequence_number: nextSeq(s),
    item_id: s.messageItemId,
    output_index: s.messageOutputIndex,
    content_index: s.contentIndex,
    text: s.textBuffer,
  })
  out.push({
    type: 'response.content_part.done',
    sequence_number: nextSeq(s),
    item_id: s.messageItemId,
    output_index: s.messageOutputIndex,
    content_index: s.contentIndex,
    part: { type: 'output_text', text: s.textBuffer, annotations: [] },
  })
  out.push({
    type: 'response.output_item.done',
    sequence_number: nextSeq(s),
    output_index: s.messageOutputIndex,
    item: {
      id: s.messageItemId,
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: s.textBuffer, annotations: [] }],
    },
  })
}

function emitToolAdded(s: StreamState, b: ToolCallBucket, out: unknown[]): void {
  b.addedEmitted = true
  out.push({
    type: 'response.output_item.added',
    sequence_number: nextSeq(s),
    output_index: b.outputIndex,
    item: {
      id: b.itemId,
      type: 'function_call',
      status: 'in_progress',
      call_id: b.callId,
      name: b.name,
      arguments: '',
    },
  })
}

function closeToolCall(s: StreamState, b: ToolCallBucket, out: unknown[]): void {
  if (!b.addedEmitted) emitToolAdded(s, b, out)
  out.push({
    type: 'response.function_call_arguments.done',
    sequence_number: nextSeq(s),
    item_id: b.itemId,
    output_index: b.outputIndex,
    arguments: b.argsBuffer,
  })
  out.push({
    type: 'response.output_item.done',
    sequence_number: nextSeq(s),
    output_index: b.outputIndex,
    item: {
      id: b.itemId,
      type: 'function_call',
      status: 'completed',
      call_id: b.callId,
      name: b.name,
      arguments: b.argsBuffer,
    },
  })
}

export function createDeepseekResponsesStreamTransform(): StreamTransform {
  const state: StreamState = {
    responseId: shortId('resp'),
    model: 'deepseek-v4-pro',
    createdAt: Math.floor(Date.now() / 1000),
    sequenceNumber: 0,
    startedEmitted: false,
    outputIndex: 0,
    messageItemId: null,
    messageOutputIndex: 0,
    contentIndex: 0,
    textBuffer: '',
    reasoningItemId: null,
    reasoningOutputIndex: 0,
    reasoningBuffer: '',
    reasoningPartOpened: false,
    toolCalls: new Map(),
    toolCallOrder: [],
    finishReason: null,
    usage: null,
  }

  return {
    transform(data: unknown): unknown[] {
      const ev = data as ChatChunk | null
      if (!ev || typeof ev !== 'object') return []
      const out: unknown[] = []

      if (!state.startedEmitted) {
        state.startedEmitted = true
        if (typeof ev.model === 'string' && ev.model) state.model = ev.model
        out.push({
          type: 'response.created',
          sequence_number: nextSeq(state),
          response: stubResponse(state, 'in_progress'),
        })
        out.push({
          type: 'response.in_progress',
          sequence_number: nextSeq(state),
          response: stubResponse(state, 'in_progress'),
        })
      }

      const choice = ev.choices?.[0]
      const delta = choice?.delta

      if (delta) {
        const reasoning = delta.reasoning_content
        if (typeof reasoning === 'string' && reasoning.length > 0) {
          if (!state.reasoningItemId) openReasoning(state, out)
          state.reasoningBuffer += reasoning
          out.push({
            type: 'response.reasoning_summary_text.delta',
            sequence_number: nextSeq(state),
            item_id: state.reasoningItemId,
            output_index: state.reasoningOutputIndex,
            summary_index: 0,
            delta: reasoning,
          })
        }

        const content = delta.content
        if (typeof content === 'string' && content.length > 0) {
          if (state.reasoningPartOpened) closeReasoning(state, out)
          if (!state.messageItemId) openMessage(state, out)
          state.textBuffer += content
          out.push({
            type: 'response.output_text.delta',
            sequence_number: nextSeq(state),
            item_id: state.messageItemId,
            output_index: state.messageOutputIndex,
            content_index: state.contentIndex,
            delta: content,
          })
        }

        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            if (!tc || typeof tc.index !== 'number') continue
            let bucket = state.toolCalls.get(tc.index)
            if (!bucket) {
              bucket = {
                itemId: shortId('fc'),
                outputIndex: state.outputIndex++,
                callId: typeof tc.id === 'string' && tc.id ? tc.id : shortId('call'),
                name: tc.function?.name ?? '',
                argsBuffer: '',
                addedEmitted: false,
              }
              state.toolCalls.set(tc.index, bucket)
              state.toolCallOrder.push(tc.index)
            } else {
              if (typeof tc.id === 'string' && tc.id && bucket.callId.startsWith('call_')) {
                bucket.callId = tc.id
              }
              if (tc.function?.name && !bucket.name) bucket.name = tc.function.name
            }

            if (!bucket.addedEmitted && bucket.name) emitToolAdded(state, bucket, out)

            const argFrag = tc.function?.arguments
            if (typeof argFrag === 'string' && argFrag.length > 0) {
              bucket.argsBuffer += argFrag
              if (bucket.addedEmitted) {
                out.push({
                  type: 'response.function_call_arguments.delta',
                  sequence_number: nextSeq(state),
                  item_id: bucket.itemId,
                  output_index: bucket.outputIndex,
                  delta: argFrag,
                })
              }
            }
          }
        }
      }

      if (choice?.finish_reason) state.finishReason = choice.finish_reason
      if (ev.usage) state.usage = ev.usage

      return out
    },

    flush(): unknown[] {
      const out: unknown[] = []

      // If transform was never called (empty upstream stream), still emit
      // a minimal created → completed pair so the client doesn't hang.
      if (!state.startedEmitted) {
        state.startedEmitted = true
        out.push({
          type: 'response.created',
          sequence_number: nextSeq(state),
          response: stubResponse(state, 'in_progress'),
        })
        out.push({
          type: 'response.in_progress',
          sequence_number: nextSeq(state),
          response: stubResponse(state, 'in_progress'),
        })
      }

      if (state.reasoningPartOpened) closeReasoning(state, out)
      if (state.messageItemId) closeMessage(state, out)
      for (const idx of state.toolCallOrder) {
        const b = state.toolCalls.get(idx)
        if (b) closeToolCall(state, b, out)
      }

      out.push({
        type: 'response.completed',
        sequence_number: nextSeq(state),
        response: {
          ...stubResponse(state, 'completed'),
          output: buildFinalOutput(state),
          usage: mapUsageToResponses(state.usage),
        },
      })
      return out
    },
  }
}
