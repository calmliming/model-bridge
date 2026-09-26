import { describe, expect, it } from 'vitest'
import { antigravityThinkingLevel, resolveAntigravityModel } from './model'

describe('Antigravity model variants', () => {
  const model = 'gemini-3.8-flash'
  const models = ['low', 'medium', 'high', 'tiered'].map(level => ({ id: `${model}-${level}` }))
  it.each([
    [{}, 'high'], [{ thinking: { type: 'disabled' } }, 'low'],
    [{ thinking: { type: 'enabled', budget_tokens: 4096 } }, 'medium'],
    [{ generationConfig: { thinkingConfig: { thinkingLevel: 'LOW' } } }, 'low'],
    [{ generationConfig: { thinkingConfig: { thinkingBudget: 0 } } }, 'low'],
    [{ generation_config: { thinking_config: { thinking_budget: 8192 } } }, 'medium'],
    [{ generationConfig: { thinkingConfig: { thinkingBudget: -1 } } }, 'high'],
  ] as const)('resolves the requested depth for %j', (body, level) => {
    expect(antigravityThinkingLevel(body)).toBe(level)
    expect(resolveAntigravityModel(model, models, antigravityThinkingLevel(body))).toBe(`${model}-${level}`)
  })
  it('preserves explicit mappings, suffixes and real bare catalog entries', () => {
    expect(resolveAntigravityModel(model, models, 'low', true)).toBe(model)
    expect(resolveAntigravityModel(`${model}-medium`, models, 'low')).toBe(`${model}-medium`)
    expect(resolveAntigravityModel(model, [...models, { id: model }], 'low')).toBe(model)
    expect(resolveAntigravityModel(model, undefined)).toBe(model)
    expect(resolveAntigravityModel('claude-sonnet-5', models)).toBe('claude-sonnet-5')
  })
  it('falls back only to variants present in this account catalog', () => {
    expect(resolveAntigravityModel(model, [{ id: `${model}-tiered` }], 'low')).toBe(`${model}-tiered`)
    expect(resolveAntigravityModel(model, [{ id: 'gemini-other-high' }], 'low')).toBe(model)
  })
})
