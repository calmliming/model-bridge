import { describe, expect, it } from 'vitest'
import { estimateResponsesInputTokens } from './inputTokens'

describe('estimateResponsesInputTokens', () => {
  it('does not count the routing model field', () => {
    const withoutModel = estimateResponsesInputTokens({ input: 'hello world' })
    const withModel = estimateResponsesInputTokens({ model: 'gpt-5.6', input: 'hello world' })
    expect(withModel).toBe(withoutModel)
  })

  it('counts structured input and CJK text without producing a negative value', () => {
    const estimate = estimateResponsesInputTokens({
      instructions: '回答问题',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
      tools: [{ type: 'function', name: 'lookup', parameters: { type: 'object' } }],
    })
    expect(estimate).toBeGreaterThan(0)
    expect(Number.isInteger(estimate)).toBe(true)
  })

  it('caps pathological payloads at the public estimate limit', () => {
    expect(estimateResponsesInputTokens({ input: 'x'.repeat(50_000_000) })).toBe(10_000_000)
  })
})
