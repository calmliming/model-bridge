import { describe, expect, it, vi } from 'vitest'
import { createResponsesFieldNormalizer } from './responseFields'
import { buildResponsesErrorEvents } from './chat'

describe('Responses required output fields', () => {
  it('ends an existing response without creating a different response identity', () => {
    const normalizer = createResponsesFieldNormalizer()
    normalizer.event({ type: 'response.created', sequence_number: 10, response: { id: 'upstream', model: 'actual-model', created_at: 123, tools: [{ type: 'function' }] } })
    const events = buildResponsesErrorEvents('closed', 'upstream_stream_closed', normalizer.errorContext('requested-model'))
    expect(events).toEqual([{ type: 'response.failed', sequence_number: 11, response: expect.objectContaining({ id: 'upstream', model: 'actual-model',
      created_at: 123, tools: [{ type: 'function' }], status: 'failed', error: { code: 'upstream_stream_closed', message: 'closed' } }) }])
  })

  it('learns response identity from response_id on streams without a created frame', () => {
    const normalizer = createResponsesFieldNormalizer()
    normalizer.event({ type: 'response.output_text.delta', response_id: 'upstream', delta: 'partial', sequence_number: 4 })
    const events = buildResponsesErrorEvents('closed', 'upstream_stream_closed', normalizer.errorContext('gpt-6.1-sol'))
    expect(events).toEqual([{ type: 'response.failed', sequence_number: 5, response: expect.objectContaining({ id: 'upstream', model: 'gpt-6.1-sol' }) }])
  })

  it('still creates a complete error sequence when upstream never started a response', () => {
    const normalizer = createResponsesFieldNormalizer()
    const events = buildResponsesErrorEvents('closed', 'upstream_stream_closed', normalizer.errorContext('gpt-6.1-sol')) as Array<{ type: string; response: { id: string; model: string } }>
    expect(events.map(event => event.type)).toEqual(['response.created', 'response.in_progress', 'response.failed'])
    expect(new Set(events.map(event => event.response.id)).size).toBe(1)
    expect(events.every(event => event.response.model === 'gpt-6.1-sol')).toBe(true)
  })

  it('uses the first upstream timestamp and advances past existing sequence numbers', () => {
    const normalizer = createResponsesFieldNormalizer()
    const first = { type: 'response.created', sequence_number: 10, response: { id: 'r', created_at: 123 } }
    expect(normalizer.event(first)).toBe(first)
    expect(normalizer.event({ type: 'response.output_text.delta', delta: 'hello' }))
      .toEqual({ type: 'response.output_text.delta', delta: 'hello', sequence_number: 11 })
    expect(normalizer.event({ type: 'response.completed', response: { id: 'r', created_at: null } }))
      .toEqual({ type: 'response.completed', sequence_number: 12, response: { id: 'r', created_at: 123 } })
  })

  it('keeps one fallback timestamp even if time or a later upstream timestamp changes', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100_000)
    try {
      const normalizer = createResponsesFieldNormalizer()
      const first = { type: 'response.created', response: { created_at: null } }
      expect(normalizer.event(first)).toMatchObject({ sequence_number: 0, response: { created_at: 100 } })
      now.mockReturnValue(200_000)
      const complete = { type: 'response.in_progress', sequence_number: 1, response: { created_at: 999 } }
      expect(normalizer.event(complete)).toBe(complete)
      expect(normalizer.event({ type: 'response.completed', response: {} }))
        .toMatchObject({ sequence_number: 2, response: { created_at: 100 } })
      expect(first.response.created_at).toBeNull()
    } finally { now.mockRestore() }
  })

  it('does not replace zero-valued timestamps or sequence numbers', () => {
    const normalizer = createResponsesFieldNormalizer()
    const object = { type: 'response.created', sequence_number: 0, response: { created_at: 0 } }
    expect(normalizer.event(object)).toBe(object)
    expect(normalizer.event({ type: 'response.completed', sequence_number: null, response: {} }))
      .toMatchObject({ sequence_number: 1, response: { created_at: 0 } })
  })

  it.each([false, true])('repairs bare and enveloped JSON without mutating it, enveloped=%s', enveloped => {
    const normalizer = createResponsesFieldNormalizer()
    const response = { object: 'response', output: [], usage: { input_tokens: 5 }, extra: 'kept', created_at: null }
    const object = enveloped ? { response, extra: 'envelope' } : response
    const result = normalizer.json(object)
    expect(result).toEqual(enveloped ? { ...object, response: { ...response, created_at: expect.any(Number) } }
      : { ...response, created_at: expect.any(Number) })
    expect(response.created_at).toBeNull()
    const complete = { ...response, created_at: 123 }
    expect(normalizer.json(complete)).toBe(complete)
  })

  it('preserves complete SSE byte-for-byte, including spacing, comments and event metadata', () => {
    const block = ': heartbeat\nevent: response.completed\nid: e1\nretry: 100\ndata: { "type": "response.completed", "sequence_number": 42,\ndata: "response": { "created_at": 123, "output": [] }, "extra": true }'
    expect(createResponsesFieldNormalizer().sseBlock(block)).toBe(block)
  })

  it('repairs multiline SSE and keeps comments, event name, id and retry', () => {
    const normalizer = createResponsesFieldNormalizer()
    normalizer.event({ type: 'response.created', sequence_number: 5, response: { created_at: 123 } })
    const result = normalizer.sseBlock(': ping\nevent: response.completed\nid: e1\nretry: 100\ndata: {"type":"response.completed","response":\ndata: {"created_at":null,"output":[]},"extra":true}')
    expect(result).toBe(': ping\nevent: response.completed\nid: e1\nretry: 100\ndata: {"type":"response.completed","response":{"created_at":123,"output":[]},"extra":true,"sequence_number":6}')
  })

  it.each([': keepalive', 'data: [DONE]', 'data: invalid', 'data: null', 'data: []',
    'data: {"type":"error","error":{"code":"bad"}}', 'data: {"type":"message_start","message":{}}'])
  ('leaves unrelated or invalid SSE untouched: %s', block => {
    expect(createResponsesFieldNormalizer().sseBlock(block)).toBe(block)
  })

  it.each([null, [], { error: { message: 'bad' } }, { type: 'message', content: [] }])
  ('leaves unrelated JSON untouched: %j', value => {
    expect(createResponsesFieldNormalizer().json(value)).toBe(value)
  })
})
