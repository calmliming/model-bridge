import { describe, expect, it } from 'vitest'
import { createOpenaiChatCompletionsStreamTransform, responsesSseToChatCompletion, chatCompletionsToResponses } from './chat'

const added = { type: 'response.output_item.added', output_index: 2,
  item: { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'lookup', arguments: '' } }
const done = { type: 'response.function_call_arguments.done', output_index: 2, arguments: '{"id":1}' }
const completed = { type: 'response.completed', response: { output: [
  { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'lookup', arguments: '' },
] } }

function chunks(events: unknown[]) {
  const transform = createOpenaiChatCompletionsStreamTransform()
  return events.flatMap(event => transform.transform(event)) as Array<Record<string, any>>
}

function toolArguments(events: unknown[]) {
  return chunks(events).flatMap(event => event?.choices?.[0]?.delta?.tool_calls ?? [])
    .map(call => call.function?.arguments ?? '').join('')
}

describe('Responses function argument reconciliation', () => {
  it('uses arguments.done even when no deltas were emitted', () => {
    expect(toolArguments([added, done, completed])).toBe('{"id":1}')
  })
  it('appends only the missing suffix after partial deltas', () => {
    expect(toolArguments([added,
      { type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '{"id":' },
      done, done, completed,
    ])).toBe('{"id":1}')
  })
  it('does not duplicate a completed item received before the final response', () => {
    const itemDone = { type: 'response.output_item.done', output_index: 2,
      item: { ...added.item, arguments: '{"id":1}' } }
    expect(toolArguments([added, done, itemDone, { ...completed, response: { output: [itemDone.item] } }]))
      .toBe('{"id":1}')
  })
  it('preserves arguments in buffered responses with empty terminal fields', () => {
    const text = [added, done, completed].map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
    const result = responsesSseToChatCompletion(text, 'gpt-6-astra')
    expect(result.body).toMatchObject({ choices: [{ message: {
      tool_calls: [{ id: 'call_1', function: { name: 'lookup', arguments: '{"id":1}' } }],
    }, finish_reason: 'tool_calls' }] })
  })
  it('keeps parallel tool calls separate when done events only identify output indices', () => {
    const second = { ...added, output_index: 4, item: { ...added.item, id: 'fc_2', call_id: 'call_2' } }
    const result = chunks([added, second, { ...done, output_index: 4, arguments: '{"id":2}' }, done])
      .flatMap(event => event?.choices?.[0]?.delta?.tool_calls ?? [])
    expect(result.filter(call => call.function.arguments)).toEqual([
      { index: 1, function: { arguments: '{"id":2}' } },
      { index: 0, function: { arguments: '{"id":1}' } },
    ])
  })
  it('reports interrupted streams instead of inventing a successful stop', () => {
    const transform = createOpenaiChatCompletionsStreamTransform()
    transform.transform({ type: 'response.output_text.delta', delta: 'partial' })
    expect(transform.flush()[0]).toMatchObject({ error: { code: 'upstream_stream_closed' } })
    expect(transform.status()).toBe('error')
  })
  it('does not turn a buffered failure after output into a success', () => {
    const text = [
      { type: 'response.output_text.delta', delta: 'partial' },
      { type: 'response.failed', response: { error: { code: 'server_error', message: 'failed' } } },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
    expect(responsesSseToChatCompletion(text, 'gpt-6-astra')).toMatchObject({ status: 'error', body: { error: { code: 'server_error' } } })
  })
  it('preserves reasoning, tier, and prompt cache settings through Chat conversion', () => {
    expect(chatCompletionsToResponses({ model: 'gpt-5.6-sol', reasoning_effort: 'none', service_tier: 'ultrafast',
      prompt_cache_key: 'session-1', prompt_cache_options: { ttl: '30m' }, messages: [],
    })).toMatchObject({ reasoning: { effort: 'none' }, service_tier: 'ultrafast',
      prompt_cache_key: 'session-1', prompt_cache_options: { ttl: '30m' } })
  })
})
