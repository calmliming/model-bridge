import { describe, expect, it } from 'vitest'
import { responsesToChatCompletions as kimi } from './kimi/converter'
import { responsesToChatCompletions as qwen } from './qwen/converter'
import { responsesToChatCompletions as xiaomi } from './xiaomi/converter'
import { responsesToChatCompletions as zhipu } from './zhipu/converter'
import { chatCompletionsToResponses } from './openai/chat'
import { chatCompletionsToClaudeMessages } from './claude/chat'
import { splitToolMedia } from './toolMedia'

const url = 'data:image/png;base64,AAAA'
const output = [{ type: 'input_text', text: 'screenshot' }, { type: 'input_image', image_url: url, detail: 'high' }]
const input = [
  { type: 'function_call', call_id: 'a', name: 'read', arguments: '{}' },
  { type: 'function_call', call_id: 'b', name: 'read', arguments: '{}' },
  { type: 'function_call_output', call_id: 'a', output },
  { type: 'function_call_output', call_id: 'b', output: 'plain result' },
]
for (const [name, convert] of Object.entries({ kimi, qwen, xiaomi, zhipu })) {
  describe(`${name} tool media`, () => {
    it('hoists media after parallel tool replies and keeps the source unchanged', () => {
      const before = structuredClone(input)
      const messages = convert({ input }).messages
      expect(messages.map(m => m.role)).toEqual(['assistant', 'tool', 'tool', 'user'])
      expect(messages[1]).toMatchObject({ content: 'screenshot', tool_call_id: 'a' })
      expect(messages[2]).toMatchObject({ content: 'plain result', tool_call_id: 'b' })
      expect(messages[3]?.content).toEqual([{ type: 'image_url', image_url: { url, detail: 'high' } }])
      expect(input).toEqual(before)
    })
    it('keeps ordinary user images and business JSON tool results', () => {
      const messages = convert({ input: [{ role: 'user', content: output },
        { type: 'function_call_output', call_id: 'a', output: { answer: 1 } }] }).messages
      expect(messages[0]?.content).toEqual([{ type: 'text', text: 'screenshot' }, { type: 'image_url', image_url: { url, detail: 'high' } }])
      expect(messages[1]?.content).toBe('{"answer":1}')
    })
    it('rejects unsupported file handles instead of silently losing data', () => {
      expect(() => convert({ input: [{ type: 'function_call_output', call_id: 'a', output: [
        { type: 'input_image', file_id: 'file-1' },
      ] }] })).toThrow(/cannot be represented/)
    })
  })
}
it('rejects known text-only GLM while keeping valid images on supported models', () => {
  expect(() => zhipu({ model: 'glm-5.2', input })).toThrow(/does not support image/)
})
it('keeps pure-image tool results nonempty without encoding images as text', () => {
  expect(splitToolMedia([output[1]])).toMatchObject({ text: '[image]', images: [{ image_url: { url } }] })
  expect(() => splitToolMedia([output[1], { type: 'unknown', data: 'x' }])).toThrow()
  expect(splitToolMedia([{ answer: 'a' }]).text).toBe('[{"answer":"a"}]')
})
it('preserves tool image batches on Chat to Responses', () => {
  const body = chatCompletionsToResponses({ messages: [
    { role: 'tool', tool_call_id: 'a', content: output },
    { role: 'tool', tool_call_id: 'b', content: 'result' },
  ] })
  expect(body.input).toEqual([
    { type: 'function_call_output', call_id: 'a', output: 'screenshot' },
    { type: 'function_call_output', call_id: 'b', output: 'result' },
    { role: 'user', content: [{ type: 'input_image', image_url: url, detail: 'high' }] },
  ])
})
it('preserves ordinary and tool images on Chat to Claude', () => {
  const body = chatCompletionsToClaudeMessages({ messages: [
    { role: 'tool', tool_call_id: 'a', content: output },
    { role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.org/image.png' } }] },
  ] }) as any
  expect(body.messages[0].content[0].content).toEqual([{ type: 'text', text: 'screenshot' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }])
  expect(body.messages[0].content[1]).toEqual({ type: 'image', source: { type: 'url', url: 'https://example.org/image.png' } })
})

it('retains legacy string content parts when adding image support to Claude', () => {
  const body = chatCompletionsToClaudeMessages({ messages: [{ role: 'user', content: ['before',
    { type: 'image_url', image_url: { url } }, { type: 'text', text: 'after' }] }] }) as any
  expect(body.messages[0].content.map((p: any) => p.type === 'text' ? p.text : p.type)).toEqual(['before', 'image', 'after'])
})
