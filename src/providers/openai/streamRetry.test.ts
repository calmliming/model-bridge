import { describe, expect, it } from 'vitest'
import { inspectResponsesSseTerminalFailure, responsesSseEmptyCompletionReason, responsesStreamStartVerdict } from './chat'
import { peekSseStart } from '../streamPeek'

const sse = (...events: unknown[]) => events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
const failure = { type: 'response.failed', response: { error: { code: 'server_is_overloaded',
  message: 'Our servers are currently overloaded. Please try again later.', headers: { 'retry-after-ms': '7000' } } } }

const emptyEvents = [
  ...['output_text', 'reasoning_summary_text', 'reasoning_text', 'function_call_arguments', 'custom_tool_call_input', 'refusal']
    .map(kind => ({ type: `response.${kind}.delta`, delta: '' })),
  ...['output_text', 'reasoning_summary_text', 'reasoning_text'].map(kind => ({ type: `response.${kind}.done`, text: '' })),
  { type: 'response.refusal.done', refusal: '' },
  ...['added', 'done'].flatMap(phase => [
    { type: `response.content_part.${phase}`, part: { type: 'output_text', text: '' } },
    { type: `response.content_part.${phase}`, part: { type: 'refusal', refusal: '' } },
    { type: `response.reasoning_summary_part.${phase}`, part: { type: 'summary_text', text: '' } },
  ]),
  ...[{ type: 'message', content: [] }, { type: 'reasoning', summary: [], encrypted_content: '' },
    { type: 'function_call', arguments: '' }, { type: 'custom_tool_call', input: '' }, { type: 'compaction', encrypted_content: '' }]
    .map(item => ({ type: 'response.output_item.added', item })),
]

describe('Responses pre-output replay boundaries', () => {
  it.each(emptyEvents)('preserves retry after $type with empty content', async event => {
    expect(responsesStreamStartVerdict(event)).toBe('continue')
    const text = sse(event, failure)
    expect(inspectResponsesSseTerminalFailure(text)).toMatchObject({ hasOutput: false, code: 'server_is_overloaded' })
    const peeked = await peekSseStart(new Response(text), responsesStreamStartVerdict, 1_000)
    expect(peeked.retryReason).toBe('response.failed')
    expect(peeked.failureEvent).toEqual(failure)
    expect(await peeked.response.text()).toBe(text)
    // Failure classification is separate from empty-completion handling.
    expect(responsesSseEmptyCompletionReason(text)).toBeNull()
  })

  it.each([
    { type: 'response.output_text.delta', delta: ' ' },
    { type: 'response.output_text.delta', delta: null },
    { type: 'response.output_text.delta' },
    { type: 'response.output_text.delta', delta: {} },
    { type: 'response.function_call_arguments.delta', delta: '{}' },
    { type: 'response.custom_tool_call_input.delta', delta: 'run' },
    { type: 'response.function_call_arguments.done', arguments: '' },
    { type: 'response.custom_tool_call_input.done', input: '' },
    { type: 'response.output_item.done', item: { type: 'function_call', arguments: '' } },
    { type: 'response.output_item.added', item: { type: 'reasoning', encrypted_content: 'ciphertext', summary: [] } },
    { type: 'response.output_item.added', item: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'thinking' }] } },
    { type: 'response.output_item.added', item: { type: 'message', content: [{ type: 'refusal', refusal: 'no' }] } },
    { type: 'response.content_part.done', part: { type: 'new_kind', text: '' } },
    { type: 'response.new_kind.delta', delta: '' },
    { type: 'unknown_event', delta: '' },
    null,
  ])('does not replay known output, tool completion or unknown data: %j', async event => {
    expect(responsesStreamStartVerdict(event)).toBe('pass')
    const text = sse(event, failure)
    expect(inspectResponsesSseTerminalFailure(text)?.hasOutput).toBe(true)
    const peeked = await peekSseStart(new Response(text), responsesStreamStartVerdict, 1_000)
    expect(peeked.retryReason).toBeNull()
    expect(await peeked.response.text()).toBe(text)
  })

  it('keeps malformed frames as a replay boundary in both paths', async () => {
    const text = 'data: not-json\n\n' + sse(failure)
    expect(inspectResponsesSseTerminalFailure(text)?.hasOutput).toBe(true)
    expect(responsesSseEmptyCompletionReason(text)).toBeNull()
    const peeked = await peekSseStart(new Response(text), responsesStreamStartVerdict, 1_000)
    expect(peeked.retryReason).toBeNull()
    expect(await peeked.response.text()).toBe(text)
  })

  it('retains a standalone error without waiting for response.failed or EOF', async () => {
    const error = { type: 'error', error: failure.response.error }
    const upstream = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(sse(error)))
    } }))
    const peeked = await peekSseStart(upstream, responsesStreamStartVerdict, 1_000)
    expect(peeked.failureEvent).toEqual(error)
    await peeked.response.body?.cancel()
  })

  it('retries an empty completion after empty content, but preserves a terminal with usage', () => {
    expect(responsesSseEmptyCompletionReason(sse(...emptyEvents, { type: 'response.completed', response: { output: [] } })))
      .toBe('empty_completed')
    expect(responsesStreamStartVerdict({ type: 'response.completed', response: { output: [], usage: { input_tokens: 5 } } }))
      .toBe('pass')
  })
})
