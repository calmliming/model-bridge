import { describe, expect, it } from 'vitest'
import {
  legacyFunctionCallCompletion,
  legacyFunctionCallStream,
  upgradeLegacyFunctionCalling,
  usesLegacyFunctions,
} from './legacyFunctions'
import { createOpenaiChatCompletionsStreamTransform } from './openai/chat'

const weather = { name: 'get_weather', description: 'Weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } }

describe('upgradeLegacyFunctionCalling', () => {
  it('returns a modern request untouched', () => {
    const body = { model: 'gpt-5.5', messages: [{ role: 'user', content: 'Hi' }], tools: [] }
    expect(upgradeLegacyFunctionCalling(body)).toBe(body)
  })

  it('turns functions into tools and a named function_call into tool_choice', () => {
    const original = { model: 'gpt-5.5', messages: [], functions: [weather, { description: 'nameless' }], function_call: { name: 'get_weather' } }
    const body = upgradeLegacyFunctionCalling(original)
    expect(body).toEqual({ model: 'gpt-5.5', messages: [],
      tools: [{ type: 'function', function: weather }],
      tool_choice: { type: 'function', function: { name: 'get_weather' } } })
    expect(original).toHaveProperty('functions')
  })

  it('appends functions after existing tools and keeps an explicit tool_choice', () => {
    const lookup = { type: 'function', function: { name: 'lookup' } }
    const body = upgradeLegacyFunctionCalling({ messages: [], tools: [lookup], functions: [weather], function_call: 'none', tool_choice: 'auto' })
    expect(body.tools).toEqual([lookup, { type: 'function', function: weather }])
    expect(body.tool_choice).toBe('auto')
  })

  it.each(['none', 'auto'])('maps function_call %s to the same tool_choice', choice => {
    expect(upgradeLegacyFunctionCalling({ messages: [], functions: [weather], function_call: choice }).tool_choice).toBe(choice)
  })

  it('pairs each legacy result with the oldest unanswered call of the same name', () => {
    const body = upgradeLegacyFunctionCalling({ messages: [
      { role: 'user', content: 'Weather in SF and NYC?' },
      { role: 'assistant', content: null, function_call: { name: 'get_weather', arguments: '{"city":"SF"}' } },
      { role: 'assistant', content: null, function_call: { name: 'get_weather', arguments: '{"city":"NYC"}' } },
      { role: 'function', name: 'get_weather', content: '72F' },
      { role: 'function', name: 'get_weather', content: '50F' },
    ] })
    expect(body.messages).toEqual([
      { role: 'user', content: 'Weather in SF and NYC?' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_legacy_1', type: 'function',
        function: { name: 'get_weather', arguments: '{"city":"SF"}' } }] },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_legacy_2', type: 'function',
        function: { name: 'get_weather', arguments: '{"city":"NYC"}' } }] },
      { role: 'tool', tool_call_id: 'call_legacy_1', content: '72F' },
      { role: 'tool', tool_call_id: 'call_legacy_2', content: '50F' },
    ])
  })

  it('assigns the same IDs on every replay and skips IDs tool_calls already use', () => {
    const request = { messages: [
      { role: 'assistant', tool_calls: [{ id: 'call_legacy_1', type: 'function', function: { name: 'lookup', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call_legacy_1', content: 'found' },
      { role: 'assistant', function_call: { name: 'get_weather', arguments: '{}' } },
      { role: 'function', name: 'get_weather', content: '72F' },
    ] }
    const first = upgradeLegacyFunctionCalling(request)
    expect((first.messages as Array<{ tool_calls?: Array<{ id: string }> }>)[2]?.tool_calls?.[0]?.id).toBe('call_legacy_2')
    expect((first.messages as Array<{ tool_call_id?: string }>)[3]?.tool_call_id).toBe('call_legacy_2')
    expect(upgradeLegacyFunctionCalling(request)).toEqual(first)
  })

  it('leaves a result without a preceding call, and a turn that already has tool_calls, as they were', () => {
    const orphan = { role: 'function', name: 'get_weather', content: '72F' }
    const both = { role: 'assistant', function_call: { name: 'x', arguments: '{}' },
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'y', arguments: '{}' } }] }
    const body = upgradeLegacyFunctionCalling({ messages: [orphan, both] })
    expect(body.messages).toEqual([orphan, both])
  })
})

describe('usesLegacyFunctions', () => {
  it.each([
    [{ functions: [weather] }, true],
    [{ functions: [weather], tools: [{ type: 'function', function: weather }] }, false],
    [{ functions: [] }, false],
    [{ tools: [] }, false],
  ])('%j -> %s', (body, expected) => {
    expect(usesLegacyFunctions(body)).toBe(expected)
  })
})

describe('legacy function_call responses', () => {
  it('rewrites a buffered completion to the first call', () => {
    const body = legacyFunctionCallCompletion({ id: 'chatcmpl-1', choices: [{ index: 0, finish_reason: 'tool_calls', message: {
      role: 'assistant', content: null, tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"SF"}' } },
        { id: 'call_2', type: 'function', function: { name: 'get_weather', arguments: '{"city":"NYC"}' } },
      ] } }] })
    expect(body).toEqual({ id: 'chatcmpl-1', choices: [{ index: 0, finish_reason: 'function_call', message: {
      role: 'assistant', content: null, function_call: { name: 'get_weather', arguments: '{"city":"SF"}' } } }] })
  })

  it('leaves a plain text completion and error bodies alone', () => {
    const text = { choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Hi' } }] }
    expect(legacyFunctionCallCompletion(text)).toEqual(text)
    const error = { error: { message: 'failed' } }
    expect(legacyFunctionCallCompletion(error)).toBe(error)
  })

  it('streams function_call deltas for the first call only', () => {
    const transform = legacyFunctionCallStream(createOpenaiChatCompletionsStreamTransform())
    transform.transform({ type: 'response.created', response: { id: 'resp_1', model: 'gpt-5.5', created_at: 1 } })
    const added = transform.transform({ type: 'response.output_item.added', output_index: 0,
      item: { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'get_weather' } })
    const args = transform.transform({ type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '{"city":"SF"}' })
    const second = transform.transform({ type: 'response.output_item.added', output_index: 1,
      item: { id: 'fc_2', type: 'function_call', call_id: 'call_2', name: 'get_weather' } })
    const secondArgs = transform.transform({ type: 'response.function_call_arguments.delta', item_id: 'fc_2', delta: '{}' })
    const done = transform.transform({ type: 'response.completed', response: { output: [
      { type: 'function_call', call_id: 'call_1', name: 'get_weather', arguments: '{"city":"SF"}' },
      { type: 'function_call', call_id: 'call_2', name: 'get_weather', arguments: '{}' },
    ] } })

    expect(added).toMatchObject([{ choices: [{ delta: { role: 'assistant', function_call: { name: 'get_weather', arguments: '' } } }] }])
    expect(args).toMatchObject([{ choices: [{ delta: { function_call: { arguments: '{"city":"SF"}' } } }] }])
    expect(second).toEqual([])
    expect(secondArgs).toEqual([])
    expect(done.at(-2)).toMatchObject({ choices: [{ finish_reason: 'function_call' }] })
    expect(done.at(-1)).toBe('[DONE]')
    expect(JSON.stringify([added, args, done])).not.toContain('tool_calls')
    expect(transform.status()).toBe('success')
  })
})
