import { describe, expect, it } from 'vitest'
import { responsesToChatCompletions as qwen } from './qwen/converter'
import { responsesToChatCompletions as zhipu } from './zhipu/converter'
import { responsesToChatCompletions as xiaomi } from './xiaomi/converter'
import { responsesToChatCompletions as kimi } from './kimi/converter'

describe.each([
  { provider: 'qwen', convert: qwen },
  { provider: 'zhipu', convert: zhipu },
  { provider: 'xiaomi', convert: xiaomi },
  { provider: 'kimi', convert: kimi },
])('$provider agent messages through the chat bridge', ({ convert }) => {
  it('preserves task envelopes, split task bodies, and replies in conversation order', () => {
    const body = { input: [
      { role: 'user', content: 'Workspace context' },
      { type: 'agent_message', author: '/root', recipient: '/root/check', content: [
        { type: 'input_text', text: 'Message Type: NEW_TASK\nPayload:\n' },
        { type: 'encrypted_content', encrypted_content: '检查转发代码。\n' },
        { type: 'text', text: 'Keep ' },
        { type: 'encrypted_content', encrypted_content: 'the original order.' },
      ] },
      { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Inspect the relay' }] },
      { role: 'assistant', content: 'Checked' },
      { type: 'agent_message', author: '/root/check', recipient: '/root',
        content: [{ type: 'input_text', text: 'Message Type: FINAL_ANSWER\nPayload:\nChecked' }] },
    ] }
    const original = structuredClone(body)

    expect(convert(body).messages).toEqual([
      { role: 'user', content: 'Workspace context' },
      { role: 'user', content: 'Message Type: NEW_TASK\nPayload:\n检查转发代码。\nKeep the original order.' },
      { role: 'assistant', content: 'Checked', reasoning_content: 'Inspect the relay' },
      { role: 'user', content: 'Message Type: FINAL_ANSWER\nPayload:\nChecked' },
    ])
    expect(body).toEqual(original)
  })

  it('accepts string content without carrying previous reasoning into the next tool call', () => {
    const out = convert({ input: [
      { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Previous turn' }] },
      { type: 'agent_message', content: '  Inspect this file.\n' },
      { type: 'function_call', call_id: 'call-1', name: 'read_file', arguments: '{"path":"relay.ts"}' },
      { type: 'function_call_output', call_id: 'call-1', output: 'File contents' },
      { role: 'assistant', content: 'Done' },
    ] })
    expect(out.messages).toEqual([
      { role: 'user', content: '  Inspect this file.\n' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function',
        function: { name: 'read_file', arguments: '{"path":"relay.ts"}' } }] },
      { role: 'tool', tool_call_id: 'call-1', content: 'File contents' },
      { role: 'assistant', content: 'Done' },
    ])
  })

  it('skips empty or malformed content and never interprets unrelated encrypted items as task text', () => {
    const contents = [undefined, null, '', [], 42, {}, [null, 1, 'ignored',
      { type: 'input_text', text: {} }, { type: 'encrypted_content', encrypted_content: 123 },
      { type: 'input_image', image_url: 'data:image/png;base64,AA==' },
      { type: 'unknown', text: 'Not a text part' },
    ]]
    const out = convert({ input: [
      { role: 'user', content: 'Start' },
      ...contents.flatMap(content => [
        { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Stale reasoning' }] },
        { type: 'agent_message', role: 'assistant', content },
        { role: 'assistant', content: 'Continue' },
      ]),
      { type: 'reasoning', encrypted_content: 'opaque-native-reasoning' },
      { role: 'assistant', content: 'End' },
    ] })
    expect(out.messages).toEqual([
      { role: 'user', content: 'Start' },
      ...contents.map(() => ({ role: 'assistant', content: 'Continue' })),
      { role: 'assistant', content: 'End' },
    ])
  })
})
