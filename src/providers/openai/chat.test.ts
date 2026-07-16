import { describe, expect, it } from 'vitest'
import {
  buildResponsesErrorEvents,
  chatCompletionsToResponses,
  createOpenaiChatCompletionsStreamTransform,
  responsesSseToChatCompletion,
} from './chat'

describe('chatCompletionsToResponses', () => {
  it('converts system and user messages into a Responses request', () => {
    const out = chatCompletionsToResponses({
      model: 'gpt-5.5',
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Say hi' },
      ],
      temperature: 0.2,
      max_tokens: 64,
    })

    expect(out).toMatchObject({
      model: 'gpt-5.5',
      instructions: 'Be brief.',
      stream: true,
      store: false,
      temperature: 0.2,
      max_output_tokens: 64,
    })
    expect(out.input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'Say hi' }] },
    ])
  })

  it('converts assistant tool calls and tool results into Responses items', () => {
    const out = chatCompletionsToResponses({
      model: 'gpt-5.5',
      messages: [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'lookup', arguments: '{"q":"hi"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'result' },
      ],
    })

    expect(out.input).toEqual([
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'lookup',
        arguments: '{"q":"hi"}',
      },
      { type: 'function_call_output', call_id: 'call_1', output: 'result' },
    ])
  })
})

describe('responsesSseToChatCompletion', () => {
  it('buffers Responses text deltas into a non-stream Chat Completion', () => {
    const sse = [
      'data: {"type":"response.created","response":{"id":"resp_1","model":"gpt-5.5","created_at":123}}',
      '',
      'data: {"type":"response.output_text.delta","delta":"hel"}',
      '',
      'data: {"type":"response.output_text.delta","delta":"lo"}',
      '',
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":3,"output_tokens":2,"input_tokens_details":{"cached_tokens":1}}}}',
      '',
      '',
    ].join('\n')

    const result = responsesSseToChatCompletion(sse, 'fallback')

    expect(result.body).toMatchObject({
      id: 'resp_1',
      object: 'chat.completion',
      created: 123,
      model: 'gpt-5.5',
      choices: [{ message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 3,
        completion_tokens: 2,
        total_tokens: 5,
        prompt_tokens_details: { cached_tokens: 1 },
      },
    })
    expect(result.usage).toEqual({
      inputTokens: 2,
      outputTokens: 2,
      reasoningTokens: 0,
      cacheCreateTokens: 0,
      cacheReadTokens: 1,
    })
  })

  it('buffers Responses function calls into Chat Completion tool calls', () => {
    const sse = [
      'data: {"type":"response.completed","response":{"id":"resp_1","model":"gpt-5.5","created_at":123,"output":[{"type":"function_call","call_id":"call_1","name":"lookup","arguments":"{}"}]}}',
      '',
      '',
    ].join('\n')

    const result = responsesSseToChatCompletion(sse, 'fallback')

    expect(result.body).toMatchObject({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'lookup', arguments: '{}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    })
  })

  it('maps a truncated response.incomplete with content to finish_reason length', () => {
    const sse = [
      'data: {"type":"response.output_text.delta","delta":"partial answer"}',
      '',
      'data: {"type":"response.incomplete","response":{"id":"resp_1","model":"gpt-5.6-sol","created_at":123,"incomplete_details":{"reason":"max_output_tokens"}}}',
      '',
      '',
    ].join('\n')

    const result = responsesSseToChatCompletion(sse, 'fallback')

    expect(result.status).toBeUndefined()
    expect(result.body).toMatchObject({
      choices: [
        {
          message: { role: 'assistant', content: 'partial answer' },
          finish_reason: 'length',
        },
      ],
    })
  })

  it('maps a content_filter response.incomplete to finish_reason content_filter', () => {
    const sse = [
      'data: {"type":"response.output_text.delta","delta":"cut"}',
      '',
      'data: {"type":"response.incomplete","response":{"incomplete_details":{"reason":"content_filter"}}}',
      '',
      '',
    ].join('\n')

    const result = responsesSseToChatCompletion(sse, 'fallback')

    expect(result.body).toMatchObject({
      choices: [{ finish_reason: 'content_filter' }],
    })
  })

  it('surfaces a mid-stream response.failed as an error body, not a hollow success', () => {
    const sse = [
      'data: {"type":"response.created","response":{"id":"resp_1","model":"gpt-5.6-sol","created_at":123}}',
      '',
      'data: {"type":"response.failed","response":{"error":{"code":"server_error","message":"boom"}}}',
      '',
      '',
    ].join('\n')

    const result = responsesSseToChatCompletion(sse, 'fallback')

    expect(result.status).toBe('error')
    expect(result.body).toEqual({
      error: { message: 'boom', type: 'server_error', code: 'server_error' },
    })
  })
})

describe('createOpenaiChatCompletionsStreamTransform', () => {
  it('rewrites Responses deltas into Chat Completions chunks', () => {
    const transform = createOpenaiChatCompletionsStreamTransform()
    const first = transform.transform({
      type: 'response.created',
      response: { id: 'resp_1', model: 'gpt-5.5', created_at: 123 },
    })
    const delta = transform.transform({ type: 'response.output_text.delta', delta: 'hi' })
    const done = transform.transform({ type: 'response.completed', response: {} })

    expect(first).toEqual([])
    expect(delta[0]).toMatchObject({
      id: 'resp_1',
      object: 'chat.completion.chunk',
      created: 123,
      model: 'gpt-5.5',
      choices: [{ delta: { role: 'assistant', content: 'hi' }, finish_reason: null }],
    })
    expect(done[0]).toMatchObject({
      choices: [{ delta: {}, finish_reason: 'stop' }],
    })
    expect(done[1]).toBe('[DONE]')
  })

  it('rewrites Responses function-call events into Chat Completions tool deltas', () => {
    const transform = createOpenaiChatCompletionsStreamTransform()
    transform.transform({
      type: 'response.created',
      response: { id: 'resp_1', model: 'gpt-5.5', created_at: 123 },
    })
    const added = transform.transform({
      type: 'response.output_item.added',
      item: { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'lookup' },
    })
    const args = transform.transform({
      type: 'response.function_call_arguments.delta',
      item_id: 'fc_1',
      delta: '{"q":"hi"}',
    })
    const done = transform.transform({
      type: 'response.completed',
      response: { output: [{ type: 'function_call', call_id: 'call_1', name: 'lookup', arguments: '{"q":"hi"}' }] },
    })

    expect(added[0]).toMatchObject({
      choices: [
        {
          delta: {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: 'lookup', arguments: '' },
              },
            ],
          },
        },
      ],
    })
    expect(args[0]).toMatchObject({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"q":"hi"}' } }] } }],
    })
    expect(done[0]).toMatchObject({ choices: [{ finish_reason: 'tool_calls' }] })
  })

  it('finishes a streamed response.incomplete with the mapped finish_reason', () => {
    const transform = createOpenaiChatCompletionsStreamTransform()
    transform.transform({
      type: 'response.created',
      response: { id: 'resp_1', model: 'gpt-5.6-sol', created_at: 123 },
    })
    transform.transform({ type: 'response.output_text.delta', delta: 'partial' })
    const done = transform.transform({
      type: 'response.incomplete',
      response: { incomplete_details: { reason: 'max_output_tokens' } },
    })

    expect(done[0]).toMatchObject({ choices: [{ delta: {}, finish_reason: 'length' }] })
    expect(done[1]).toBe('[DONE]')
    expect(transform.flush()).toEqual([])
  })

  it('surfaces a streamed response.failed as an error chunk, not a clean stop', () => {
    const transform = createOpenaiChatCompletionsStreamTransform()
    transform.transform({
      type: 'response.created',
      response: { id: 'resp_1', model: 'gpt-5.6-sol', created_at: 123 },
    })
    const failed = transform.transform({
      type: 'response.failed',
      response: { error: { code: 'server_error', message: 'boom' } },
    })

    expect(failed[0]).toEqual({ error: { message: 'boom', type: 'server_error', code: 'server_error' } })
    expect(failed[1]).toBe('[DONE]')
    expect(transform.flush()).toEqual([])
  })
})

describe('buildResponsesErrorEvents', () => {
  it('emits a created → in_progress → failed sequence carrying the error', () => {
    const events = buildResponsesErrorEvents('usage limit reached', 'rate_limit_exceeded') as Array<{
      type: string
      response: { status: string; error?: { code: string; message: string } }
    }>

    expect(events.map((e) => e.type)).toEqual([
      'response.created',
      'response.in_progress',
      'response.failed',
    ])
    const failed = events[2]!
    expect(failed.response.status).toBe('failed')
    expect(failed.response.error).toEqual({ code: 'rate_limit_exceeded', message: 'usage limit reached' })
  })
})
