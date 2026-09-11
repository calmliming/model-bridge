import { randomUUID } from 'node:crypto'
import { emptyUsage, type UsageData } from '../types'
import * as geminiUsage from '../gemini/usage'
import { unwrapResponseEnvelope } from '../gemini/relay'
import { object } from './client'
import { rememberToolSignature, type SignatureScope } from './signatures'

function usageFields(usage: UsageData): Record<string, number> {
  return { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens,
    cache_read_input_tokens: usage.cacheReadTokens, cache_creation_input_tokens: usage.cacheCreateTokens }
}

export function createAntigravityUsageParser() {
  const parser = geminiUsage.createStreamParser()
  return { feed: (event: unknown) => parser.feed(unwrapResponseEnvelope(event)), result: parser.result }
}

export function parseAntigravityUsage(body: unknown): UsageData {
  return geminiUsage.parseJsonUsage(unwrapResponseEnvelope(body))
}

/** Stateful Gemini SSE → Messages; no synthetic success on a truncated stream. */
export function createAntigravityMessagesTransform(scope: SignatureScope) {
  let started = false
  let flushed = false
  let finishReason = ''
  let failed = false
  let index = -1
  let active: 'text' | 'thinking' | null = null
  let signature = ''
  let usedTool = false
  let usage = emptyUsage()
  const seenCalls = new Set<string>()
  const id = `msg_${randomUUID().replace(/-/g, '')}`
  const closeBlock = (events: unknown[]) => {
    if (!active) return
    if (signature) events.push({ type: 'content_block_delta', index, delta: { type: 'signature_delta', signature } })
    events.push({ type: 'content_block_stop', index })
    active = null
    signature = ''
  }
  const start = (events: unknown[]) => {
    if (started) return
    started = true
    events.push({ type: 'message_start', message: { id, type: 'message', role: 'assistant', model: scope.model,
      content: [], stop_reason: null, stop_sequence: null, usage: usageFields(usage) } })
  }
  return {
    transform(raw: unknown): unknown[] {
      if (flushed) return []
      const response = object(unwrapResponseEnvelope(raw))
      if (!response) return []
      const events: unknown[] = []
      if (response.usageMetadata) usage = geminiUsage.parseJsonUsage(response)
      start(events)
      if (response.error || object(response.promptFeedback)?.blockReason) {
        failed = true
        return events
      }
      const candidate = Array.isArray(response.candidates) ? object(response.candidates[0]) : null
      const parts = object(candidate?.content)?.parts
      for (const part of Array.isArray(parts) ? parts.map(object) : []) {
        if (!part) continue
        const call = object(part.functionCall)
        const sig = typeof part.thoughtSignature === 'string' ? part.thoughtSignature : ''
        if (call) {
          closeBlock(events)
          if (typeof call.name !== 'string' || (call.args != null && !object(call.args))) { failed = true; continue }
          const callId = typeof call.id === 'string' && call.id ? call.id : `toolu_${randomUUID().replace(/-/g, '')}`
          if (sig) rememberToolSignature(scope, callId, sig)
          if (seenCalls.has(callId)) continue
          seenCalls.add(callId)
          usedTool = true
          index++
          events.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: callId, name: call.name, input: {}, ...(sig ? { signature: sig } : {}) } },
            { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.args ?? {}) } },
            { type: 'content_block_stop', index })
        } else if (typeof part.text === 'string' || sig) {
          const kind = part.thought === true || typeof part.text !== 'string' ? 'thinking' : 'text'
          if (active !== kind) {
            closeBlock(events)
            active = kind
            index++
            events.push({ type: 'content_block_start', index, content_block: kind === 'thinking' ? { type: 'thinking', thinking: '' } : { type: 'text', text: '' } })
          }
          if (typeof part.text === 'string' && part.text) events.push({ type: 'content_block_delta', index,
            delta: kind === 'thinking' ? { type: 'thinking_delta', thinking: part.text } : { type: 'text_delta', text: part.text } })
          if (sig && kind === 'thinking') signature = sig
          else if (sig) {
            closeBlock(events)
            index++
            active = 'thinking'
            signature = sig
            events.push({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '' } })
          }
        } else if (Object.keys(part).length) {
          // Do not silently discard an image/audio/server-tool response in Messages.
          failed = true
        }
      }
      if (typeof candidate?.finishReason === 'string' && candidate.finishReason) {
        finishReason = candidate.finishReason
        if (!['STOP', 'MAX_TOKENS'].includes(finishReason)) failed = true
      }
      return events
    },
    flush(): unknown[] {
      if (flushed) return []
      flushed = true
      const events: unknown[] = []
      start(events)
      closeBlock(events)
      if (failed || !finishReason) {
        failed = true
        events.push({ type: 'error', error: { type: 'upstream_error', code: finishReason || 'upstream_stream_closed',
          message: finishReason ? `Antigravity ended the response with ${finishReason}.` : 'Antigravity stream ended without a completion event.' } })
      } else {
        events.push({ type: 'message_delta', delta: { stop_reason: usedTool ? 'tool_use' : finishReason === 'MAX_TOKENS' ? 'max_tokens' : 'end_turn', stop_sequence: null }, usage: usageFields(usage) },
          { type: 'message_stop' })
      }
      return events
    },
    status: (): 'success' | 'error' => failed || !finishReason ? 'error' : 'success',
  }
}

function accumulateMessages(events: unknown[], usage: UsageData, model: string) {
  const content: Record<string, unknown>[] = []
  const argumentsByIndex = new Map<number, string>()
  let id = `msg_${randomUUID().replace(/-/g, '')}`
  let stopReason: unknown = null
  let error: unknown
  for (const raw of events) {
    const event = object(raw)
    if (!event) continue
    if (event.type === 'message_start') id = String(object(event.message)?.id ?? id)
    const index = typeof event.index === 'number' ? event.index : -1
    if (event.type === 'content_block_start' && index >= 0) content[index] = { ...object(event.content_block) }
    const block = content[index]
    const delta = object(event.delta)
    if (event.type === 'content_block_delta' && block && delta) {
      if (delta.type === 'text_delta') block.text = String(block.text ?? '') + String(delta.text ?? '')
      if (delta.type === 'thinking_delta') block.thinking = String(block.thinking ?? '') + String(delta.thinking ?? '')
      if (delta.type === 'signature_delta') block.signature = delta.signature
      if (delta.type === 'input_json_delta') argumentsByIndex.set(index, (argumentsByIndex.get(index) ?? '') + String(delta.partial_json ?? ''))
    }
    if (event.type === 'message_delta') stopReason = delta?.stop_reason
    if (event.type === 'error') error = event.error
  }
  for (const [index, value] of argumentsByIndex) content[index]!.input = JSON.parse(value)
  if (error) return { body: { type: 'error', error, usage: usageFields(usage) }, usage, status: 'error' as const, httpStatus: 502 }
  return { body: { id, type: 'message', role: 'assistant', model, content: content.filter(Boolean), stop_reason: stopReason,
    stop_sequence: null, usage: usageFields(usage) }, usage }
}

export function antigravitySseToMessages(text: string, scope: SignatureScope) {
  const transform = createAntigravityMessagesTransform(scope)
  const parser = createAntigravityUsageParser()
  const events: unknown[] = []
  for (const block of text.replace(/\r\n/g, '\n').split('\n\n')) {
    const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
    if (!data || data === '[DONE]') continue
    const item: unknown = JSON.parse(data)
    parser.feed(item)
    events.push(...transform.transform(item))
  }
  events.push(...transform.flush())
  return accumulateMessages(events, parser.result(), scope.model)
}

export function antigravityJsonToMessages(body: unknown, scope: SignatureScope) {
  const transform = createAntigravityMessagesTransform(scope)
  return accumulateMessages([...transform.transform(body), ...transform.flush()], parseAntigravityUsage(body), scope.model)
}
