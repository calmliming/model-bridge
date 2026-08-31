import { describe, expect, it } from 'vitest'
import {
  buildResponsesErrorEvents,
  chatCompletionsToResponses,
  createOpenaiChatCompletionsStreamTransform,
  inspectResponsesSseTerminalFailure,
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

  it('normalizes null tool parameters for the Codex schema', () => {
    const out = chatCompletionsToResponses({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'use the tool' }],
      tools: [{ type: 'function', function: { name: 'lookup', parameters: null } }],
    })

    expect(out.tools).toEqual([
      { type: 'function', name: 'lookup', parameters: { type: 'object', properties: {} } },
    ])
  })

  it('preserves image and file content when converting vision chat requests', () => {
    const out = chatCompletionsToResponses({
      model: 'deepseek-v4-flash-vision-exp',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Read this image.' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,abc', detail: 'low' } },
            { type: 'file', file_id: 'file-api-123' },
          ],
        },
      ],
    })

    expect(out.input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Read this image.' },
          { type: 'input_image', image_url: 'data:image/png;base64,abc', detail: 'low' },
          { type: 'input_image', file_id: 'file-api-123' },
        ],
      },
    ])
  })

  it('carries chat user isolation into Responses user', () => {
    expect(chatCompletionsToResponses({
      model: 'deepseek-v4-flash',
      user_id: 'tenant-user',
      messages: [{ role: 'user', content: 'hi' }],
    })).toMatchObject({ user: 'tenant-user' })
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
    expect(result.httpStatus).toBe(502)
    expect(result.body).toEqual({
      error: { message: 'boom', type: 'server_error', code: 'server_error' },
    })
  })

  it('maps a rate-limit terminal to HTTP 429 for buffered clients', () => {
    const result = responsesSseToChatCompletion([
      'data: {"type":"response.failed","response":{"error":{"code":"server_error","message":"capacity unavailable"}}}',
      '',
    ].join('\n'), 'fallback')
    expect(result.httpStatus).toBe(429)
  })
})

describe('inspectResponsesSseTerminalFailure', () => {
  it('finds a retryable response.failed before any visible output', () => {
    const failure = inspectResponsesSseTerminalFailure([
      'data: {"type":"response.created","response":{"id":"r1"}}',
      '',
      'data: {"type":"response.failed","response":{"error":{"code":"server_error","message":"capacity unavailable"}}}',
      '',
    ].join('\n'))

    expect(failure).toMatchObject({
      terminalType: 'response.failed',
      code: 'server_error',
      message: 'capacity unavailable',
      hasOutput: false,
    })
  })

  it('marks a failure after output as unsafe for failover', () => {
    const failure = inspectResponsesSseTerminalFailure([
      'data: {"type":"response.output_text.delta","delta":"partial"}',
      '',
      'data: {"type":"response.failed","response":{"error":{"code":"server_error","message":"boom"}}}',
      '',
    ].join('\n'))

    expect(failure?.hasOutput).toBe(true)
  })

  it('does not treat response.incomplete as a retry failure', () => {
    expect(inspectResponsesSseTerminalFailure([
      'data: {"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"}}}',
      '',
    ].join('\n'))).toBeNull()
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
