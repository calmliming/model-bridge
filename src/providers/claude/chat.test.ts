import { describe, expect, it } from 'vitest'
import {
  chatCompletionsToClaudeMessages,
  claudeMessageToChatCompletion,
  claudeSseToChatCompletion,
  createClaudeChatCompletionsStreamTransform,
  mapStopReason,
} from './chat'

describe('chatCompletionsToClaudeMessages', () => {
  it('hoists system/developer turns into system and keeps max_tokens', () => {
    const out = chatCompletionsToClaudeMessages({
      model: 'claude-opus-4',
      max_tokens: 256,
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'hi' },
      ],
    })
    expect(out.system).toBe('be terse')
    expect(out.max_tokens).toBe(256)
    expect(out.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }])
  })

  it('defaults max_tokens when the client omits it', () => {
    const out = chatCompletionsToClaudeMessages({ model: 'claude', messages: [{ role: 'user', content: 'x' }] })
    expect(out.max_tokens).toBe(4096)
  })

  it('converts assistant tool_calls into tool_use blocks', () => {
    const out = chatCompletionsToClaudeMessages({
      model: 'claude',
      messages: [
        { role: 'user', content: 'weather?' },
        {
          role: 'assistant',
          content: 'let me check',
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"SF"}' } },
          ],
        },
      ],
    })
    expect(out.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'weather?' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'let me check' },
          { type: 'tool_use', id: 'call_1', name: 'get_weather', input: { city: 'SF' } },
        ],
      },
    ])
  })

  it('folds tool results into a user turn as tool_result blocks', () => {
    const out = chatCompletionsToClaudeMessages({
      model: 'claude',
      messages: [
        { role: 'tool', tool_call_id: 'call_1', content: '72F' },
      ],
    })
    expect(out.messages).toEqual([
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '72F' }] },
    ])
  })

  it('merges consecutive same-role turns to keep roles alternating', () => {
    const out = chatCompletionsToClaudeMessages({
      model: 'claude',
      messages: [
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
      ],
    })
    expect(out.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
    ])
  })

  it('maps tools and tool_choice', () => {
    const out = chatCompletionsToClaudeMessages({
      model: 'claude',
      messages: [{ role: 'user', content: 'x' }],
      tools: [
        { type: 'function', function: { name: 'f', description: 'd', parameters: { type: 'object' } } },
      ],
      tool_choice: 'required',
    })
    expect(out.tools).toEqual([{ name: 'f', description: 'd', input_schema: { type: 'object' } }])
    expect(out.tool_choice).toEqual({ type: 'any' })
  })
})

describe('mapStopReason', () => {
  it('maps Anthropic stop reasons to OpenAI finish reasons', () => {
    expect(mapStopReason('end_turn')).toBe('stop')
    expect(mapStopReason('stop_sequence')).toBe('stop')
    expect(mapStopReason('max_tokens')).toBe('length')
    expect(mapStopReason('tool_use')).toBe('tool_calls')
  })
})

describe('claudeMessageToChatCompletion', () => {
  it('converts text + usage', () => {
    const { body, usage } = claudeMessageToChatCompletion(
      {
        id: 'msg_1',
        model: 'claude-opus-4',
        content: [{ type: 'text', text: 'hello' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      'fallback',
    )
    const choice = (body.choices as any[])[0]
    expect(body.id).toBe('msg_1')
    expect(choice.message).toEqual({ role: 'assistant', content: 'hello' })
    expect(choice.finish_reason).toBe('stop')
    expect(body.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 })
    expect(usage).toMatchObject({ inputTokens: 10, outputTokens: 5 })
  })

  it('converts tool_use blocks into tool_calls with tool_calls finish reason', () => {
    const { body } = claudeMessageToChatCompletion(
      {
        model: 'claude',
        content: [{ type: 'tool_use', id: 'tu_1', name: 'lookup', input: { q: 1 } }],
        stop_reason: 'tool_use',
      },
      'fallback',
    )
    const choice = (body.choices as any[])[0]
    expect(choice.message.content).toBeNull()
    expect(choice.message.tool_calls).toEqual([
      { id: 'tu_1', type: 'function', function: { name: 'lookup', arguments: '{"q":1}' } },
    ])
    expect(choice.finish_reason).toBe('tool_calls')
  })
})

/** Runs a list of Anthropic events through the stream transform, flattening output. */
function runTransform(events: unknown[]): unknown[] {
  const t = createClaudeChatCompletionsStreamTransform()
  const out: unknown[] = []
  for (const e of events) out.push(...t.transform(e))
  out.push(...t.flush())
  return out
}

describe('createClaudeChatCompletionsStreamTransform', () => {
  it('translates a text stream into chat.completion.chunk events ending with [DONE]', () => {
    const out = runTransform([
      { type: 'message_start', message: { id: 'msg_1', model: 'claude-opus-4' } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
      { type: 'message_stop' },
    ])
    expect(out[out.length - 1]).toBe('[DONE]')
    const chunks = out.filter((c): c is Record<string, any> => c !== '[DONE]')
    // first content chunk carries the role
    expect(chunks[0].choices[0].delta).toEqual({ role: 'assistant', content: 'Hel' })
    expect(chunks[1].choices[0].delta).toEqual({ content: 'lo' })
    // final chunk carries finish_reason
    const finalChunk = chunks[chunks.length - 1]
    expect(finalChunk.choices[0].finish_reason).toBe('stop')
    expect(chunks.every((c) => c.object === 'chat.completion.chunk')).toBe(true)
  })

  it('streams tool_use blocks as incremental tool_calls', () => {
    const out = runTransform([
      { type: 'message_start', message: { model: 'claude' } },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_1', name: 'lookup' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"q":' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '1}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
      { type: 'message_stop' },
    ])
    const chunks = out.filter((c): c is Record<string, any> => c !== '[DONE]')
    expect(chunks[0].choices[0].delta.tool_calls[0]).toMatchObject({
      index: 0,
      id: 'tu_1',
      type: 'function',
      function: { name: 'lookup', arguments: '' },
    })
    expect(chunks[1].choices[0].delta.tool_calls[0]).toEqual({ index: 0, function: { arguments: '{"q":' } })
    expect(chunks[2].choices[0].delta.tool_calls[0]).toEqual({ index: 0, function: { arguments: '1}' } })
    expect(chunks[chunks.length - 1].choices[0].finish_reason).toBe('tool_calls')
  })

  it('surfaces a mid-stream error event instead of silently ending', () => {
    const out = runTransform([
      { type: 'message_start', message: { id: 'msg_1', model: 'claude' } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } },
      { type: 'error', error: { type: 'overloaded_error', message: 'overloaded' } },
    ])
    expect(out[out.length - 1]).toBe('[DONE]')
    const errorEvent = out.find(
      (c): c is Record<string, any> => c !== '[DONE]' && !!(c as Record<string, unknown>).error,
    )
    expect(errorEvent?.error).toEqual({
      message: 'overloaded',
      type: 'overloaded_error',
      code: 'overloaded_error',
    })
  })
})

describe('claudeSseToChatCompletion', () => {
  it('buffers a streamed text response into one Chat Completion', () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_9","model":"claude-opus-4","usage":{"input_tokens":8}}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi there"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n')
    const { body, usage } = claudeSseToChatCompletion(sse, 'fallback')
    const choice = (body.choices as any[])[0]
    expect(body.id).toBe('msg_9')
    expect(body.model).toBe('claude-opus-4')
    expect(choice.message).toEqual({ role: 'assistant', content: 'Hi there' })
    expect(choice.finish_reason).toBe('stop')
    expect(body.usage).toEqual({ prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 })
    expect(usage).toMatchObject({ inputTokens: 8, outputTokens: 3 })
  })
})
