import { randomBytes } from 'node:crypto'

export interface StreamEndContext { interrupted?: boolean; clientCanceled?: boolean }
export interface StreamTransform {
  transform(data: unknown): unknown[]
  flush(context?: StreamEndContext): unknown[]
  status(): 'success' | 'error'
}
type Row = Record<string, any>
interface OutputItem { item: Row; index: number; closed: boolean; added: boolean; sentArgs: number; callIdKnown?: boolean }
const id = (prefix: string) => `${prefix}_${randomBytes(12).toString('hex')}`
const row = (value: unknown): Row | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null

/** Shared lifecycle for the four Chat-backed Responses adapters. Usage stays upstream-owned. */
export function createChatResponsesStreamTransform(defaultModel: string): StreamTransform {
  const responseId = id('resp')
  const createdAt = Math.floor(Date.now() / 1000)
  let model = defaultModel
  let sequence = 0
  let started = false
  let flushed = false
  let failed = false
  let finishReason: string | null = null
  let failure: Row | null = null
  let usage: Row | null = null
  const outputs: OutputItem[] = []
  const tools = new Map<number, OutputItem>()
  let active: OutputItem | null = null
  const emit = (out: Row[], type: string, fields: Row = {}) => out.push({ type, sequence_number: sequence++, ...fields })
  const response = (status: string): Row => ({ id: responseId, object: 'response', created_at: createdAt,
    status, model, output: [], parallel_tool_calls: false, tool_choice: 'auto', tools: [] })
  const add = (out: Row[], entry: OutputItem) => {
    if (entry.added) return
    entry.added = true
    emit(out, 'response.output_item.added', { output_index: entry.index, item: { ...entry.item, ...(entry.item.type === 'function_call' ? { arguments: '' } : {}) } })
  }
  const close = (out: Row[], entry: OutputItem) => {
    if (entry.closed) return
    const item = entry.item
    if (item.type === 'function_call') {
      add(out, entry)
      const rest = item.arguments.slice(entry.sentArgs)
      if (rest) emit(out, 'response.function_call_arguments.delta', { output_index: entry.index, item_id: item.id, delta: rest })
      emit(out, 'response.function_call_arguments.done', { output_index: entry.index, item_id: item.id, arguments: item.arguments })
    } else if (item.type === 'reasoning') {
      const text = item.summary[0].text
      const fields = { output_index: entry.index, item_id: item.id, summary_index: 0 }
      emit(out, 'response.reasoning_summary_text.done', { ...fields, text })
      emit(out, 'response.reasoning_summary_part.done', { ...fields, part: { type: 'summary_text', text } })
      item.encrypted_content = `mb1:${Buffer.from(text, 'utf8').toString('base64')}`
    } else {
      const text = item.content[0].text
      const fields = { output_index: entry.index, item_id: item.id, content_index: 0 }
      emit(out, 'response.output_text.done', { ...fields, text })
      emit(out, 'response.content_part.done', { ...fields, part: { type: 'output_text', text, annotations: [] } })
    }
    item.status = 'completed'
    entry.closed = true
    emit(out, 'response.output_item.done', { output_index: entry.index, item: structuredClone(item) })
  }
  const closeTools = (out: Row[]) => { for (const entry of tools.values()) close(out, entry) }
  const closeActive = (out: Row[]) => { if (active) close(out, active); active = null }
  const appendText = (out: Row[], kind: 'reasoning' | 'message', text: string) => {
    // Tool arguments may interleave with text; keep those items open until finish_reason.
    if (!active || active.item.type !== kind || active.closed) {
      closeActive(out)
      const item: Row = kind === 'reasoning'
        ? { id: id('rs'), type: kind, summary: [] }
        : { id: id('msg'), type: kind, role: 'assistant', status: 'in_progress', content: [] }
      active = { item, index: outputs.length, closed: false, added: false, sentArgs: 0 }
      outputs.push(active)
      add(out, active)
      if (kind === 'reasoning') {
        item.summary = [{ type: 'summary_text', text: '' }]
        emit(out, 'response.reasoning_summary_part.added', { output_index: active.index, item_id: item.id,
          summary_index: 0, part: { type: 'summary_text', text: '' } })
      } else {
        item.content = [{ type: 'output_text', text: '', annotations: [] }]
        emit(out, 'response.content_part.added', { output_index: active.index, item_id: item.id,
          content_index: 0, part: { type: 'output_text', text: '', annotations: [] } })
      }
    }
    const entry = active
    if (kind === 'reasoning') {
      entry.item.summary[0].text += text
      emit(out, 'response.reasoning_summary_text.delta', { output_index: entry.index, item_id: entry.item.id, summary_index: 0, delta: text })
    } else {
      entry.item.content[0].text += text
      emit(out, 'response.output_text.delta', { output_index: entry.index, item_id: entry.item.id, content_index: 0, delta: text })
    }
  }
  return {
    transform(data) {
      const ev = row(data)
      if (!ev || flushed || failure) return []
      const out: Row[] = []
      if (!started) {
        started = true
        if (typeof ev.model === 'string' && ev.model) model = ev.model
        emit(out, 'response.created', { response: response('in_progress') })
        emit(out, 'response.in_progress', { response: response('in_progress') })
      }
      if (row(ev.usage)) usage = ev.usage
      if (ev.error) {
        failure = { code: typeof ev.error.code === 'string' ? ev.error.code : 'upstream_error',
          message: typeof ev.error.message === 'string' ? ev.error.message : 'Upstream stream reported an error.' }
        return out
      }
      const choice = row(ev.choices?.[0])
      const delta = row(choice?.delta)
      if (delta) {
        if (delta.reasoning_content || delta.content || delta.tool_calls?.length) finishReason = null
        if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) appendText(out, 'reasoning', delta.reasoning_content)
        if (typeof delta.content === 'string' && delta.content) appendText(out, 'message', delta.content)
        if (Array.isArray(delta.tool_calls) && delta.tool_calls.length) {
          closeActive(out)
          for (const tc of delta.tool_calls) {
            if (!row(tc) || !Number.isInteger(tc.index) || tc.index < 0) continue
            let entry = tools.get(tc.index)
            if (!entry || entry.closed) {
              entry = { index: outputs.length, closed: false, added: false, sentArgs: 0, callIdKnown: false,
                item: { id: id('fc'), type: 'function_call', status: 'in_progress',
                  call_id: typeof tc.id === 'string' && tc.id ? tc.id : id('call'), name: '', arguments: '' } }
              tools.set(tc.index, entry)
              outputs.push(entry)
            }
            if (!entry.added && typeof tc.id === 'string' && tc.id) { entry.item.call_id = tc.id; entry.callIdKnown = true }
            if (typeof tc.function?.name === 'string' && tc.function.name) entry.item.name ||= tc.function.name
            if (entry.item.name && entry.callIdKnown && !entry.added) add(out, entry)
            if (typeof tc.function?.arguments === 'string') entry.item.arguments += tc.function.arguments
            if (entry.added) {
              const rest = entry.item.arguments.slice(entry.sentArgs)
              if (rest) emit(out, 'response.function_call_arguments.delta', { output_index: entry.index, item_id: entry.item.id, delta: rest })
              entry.sentArgs = entry.item.arguments.length
            }
          }
        }
      }
      if (typeof choice?.finish_reason === 'string' && choice.finish_reason) {
        finishReason = choice.finish_reason
        closeActive(out)
        closeTools(out)
      }
      return out
    },
    flush(context = {}) {
      if (flushed) return []
      flushed = true
      const out: Row[] = []
      closeActive(out)
      closeTools(out)
      const interrupted = context.interrupted || context.clientCanceled || !finishReason
      const incomplete = finishReason === 'length' || finishReason === 'content_filter'
      const success = finishReason === 'stop' || finishReason === 'tool_calls' || finishReason === 'function_call'
      failed = !!failure || !!interrupted || !success
      const status = failure || interrupted || (!success && !incomplete) ? 'failed' : incomplete ? 'incomplete' : 'completed'
      const final = response(status)
      final.output = outputs.map(entry => structuredClone(entry.item))
      // Absence is meaningful: do not fabricate a zero usage object.
      if (usage) {
        const input = usage.prompt_tokens ?? 0, output = usage.completion_tokens ?? 0
        final.usage = { input_tokens: input, output_tokens: output, total_tokens: input + output,
          input_tokens_details: { cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? usage.cached_tokens ?? 0 },
          output_tokens_details: { reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens ?? 0 } }
      }
      if (status === 'failed') final.error = failure ?? {
        code: context.clientCanceled ? 'client_disconnected' : 'upstream_stream_closed',
        message: context.clientCanceled ? 'Client disconnected during generation.' : 'Upstream stream ended before successful completion.' }
      if (status === 'incomplete') final.incomplete_details = { reason: finishReason === 'length' ? 'max_output_tokens' : 'content_filter' }
      emit(out, `response.${status}`, { response: final })
      return out
    },
    status: () => failed ? 'error' : 'success',
  }
}
