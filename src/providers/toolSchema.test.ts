import { describe, expect, it } from 'vitest'
import { anthropicToolSchema, sanitizeToolSchemas } from './toolSchema'
import { chatCompletionsToClaudeMessages } from './claude/chat'
import { normalizeOpenaiResponsesBody } from './openai/relay'

describe('tool schema compatibility', () => {
  it('cleans schema nodes in Messages, Chat and Responses without editing data or the original request', () => {
    const schema = { type: 'object', required: null, properties: {
      required: { type: 'object', required: null, default: { required: null } },
      choice: { anyOf: [{ type: 'object', required: null }, { type: 'string' }] },
    }, $defs: { child: { required: null } }, enum: [{ required: null }] }
    const input = { messages: [{ content: { required: null } }], tools: [
      { name: 'messages', input_schema: schema },
      { type: 'function', name: 'responses', parameters: schema },
      { type: 'function', function: { name: 'chat', parameters: schema } },
    ] }
    const before = structuredClone(input)
    const result = sanitizeToolSchemas(input) as typeof input
    for (const tool of result.tools) {
      const cleaned = tool.input_schema ?? tool.parameters ?? tool.function?.parameters
      expect(cleaned).not.toHaveProperty('required')
      expect(cleaned?.properties.required).toEqual({ type: 'object', default: { required: null } })
      expect(cleaned?.properties.choice.anyOf[0]).toEqual({ type: 'object' })
      expect(cleaned?.$defs.child).toEqual({})
      expect(cleaned?.enum).toEqual([{ required: null }])
    }
    expect(result.messages).toEqual(before.messages)
    expect(input).toEqual(before)
    expect((normalizeOpenaiResponsesBody(input).tools as typeof input.tools)[1]?.parameters).not.toHaveProperty('required')
  })

  it('projects root variants into optional branch fields and retains nested unions', () => {
    const parameters = { anyOf: [
      { type: 'object', properties: { mode: { const: 'create' }, name: { type: 'string' } }, required: ['mode', 'name'] },
      { type: 'object', properties: { mode: { const: 'view' }, id: { type: 'string' } }, required: ['mode', 'id'] },
    ] }
    const before = structuredClone(parameters)
    const result = chatCompletionsToClaudeMessages({ tools: [{ type: 'function', function: { name: 'task', parameters } }] })
    expect(result.tools).toEqual([{ name: 'task', input_schema: { type: 'object', properties: {
      mode: { anyOf: [{ const: 'create' }, { const: 'view' }] }, name: { type: 'string' }, id: { type: 'string' },
    }, required: ['mode'] } }])
    expect(parameters).toEqual(before)
  })

  it('combines allOf requirements and keeps root constraints on shared fields', () => {
    expect(anthropicToolSchema({ properties: { value: { minimum: 0 } }, required: ['root'], allOf: [
      { properties: { value: { type: 'number' }, a: { type: 'string' } }, required: ['a'] },
      { properties: { value: { maximum: 10 } }, required: ['value'] },
    ] })).toEqual({ type: 'object', properties: {
      value: { allOf: [{ minimum: 0 }, { allOf: [{ type: 'number' }, { maximum: 10 }] }] }, a: { type: 'string' },
    }, required: ['root', 'a', 'value'] })
  })

  it('handles nested root unions and literal prototype-shaped property names', () => {
    const result = anthropicToolSchema(JSON.parse('{"oneOf":[{"anyOf":[{"properties":{"__proto__":{"type":"string"}},"required":["__proto__"]}]},{"type":"null"}]}'))
    expect(Object.hasOwn(result.properties as object, '__proto__')).toBe(true)
    expect(result.required).toBeUndefined()
    expect(result.oneOf).toBeUndefined()
  })
})
