import { describe, expect, it } from 'vitest'
import { antigravityThinking } from './thinking'
import { antigravityThinkingLevel, resolveAntigravityModel } from './model'
import { messagesToGemini, prepareAntigravityGemini } from './converter'

describe('consistent Gemini thinking interpretation', () => {
  const model = 'gemini-4-argon'
  const catalog = ['low', 'medium', 'high'].map(level => ({ id: `${model}-${level}` }))

  it.each(['low', 'medium', 'high'])('uses %s in both the variant and the outgoing Messages config', level => {
    const input = { messages: [], thinking: { type: 'adaptive' }, output_config: { effort: level } }
    expect(antigravityThinkingLevel(input, model)).toBe(level)
    expect(resolveAntigravityModel(model, catalog, antigravityThinkingLevel(input, model))).toBe(`${model}-${level}`)
    expect(messagesToGemini(input, model).generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: level, includeThoughts: true } })
  })

  it.each([
    [{ reasoning_effort: 'low' }, 'low'], [{ reasoning: { effort: 'medium' } }, 'medium'],
    [{ thinking: { type: 'adaptive' } }, 'high'],
    [{ thinking: { type: 'enabled', budget_tokens: 4096 } }, 'medium'],
    [{ thinking: { type: 'disabled' }, output_config: { effort: 'high' } }, 'low'],
  ] as const)('uses a single level for %j', (settings, level) => {
    const body = { ...settings, messages: [] }
    expect(antigravityThinkingLevel(body, model)).toBe(level)
    expect(messagesToGemini(body, model).generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: level } })
  })

  it('preserves explicit model tiers and native levels before compatibility effort', () => {
    const body = { output_config: { effort: 'low' }, generationConfig: { thinkingConfig: { thinkingLevel: 'medium', includeThoughts: true } } }
    expect(antigravityThinking(body, model).level).toBe('medium')
    expect(antigravityThinking(body, `${model}-high`).level).toBe('high')
    expect(prepareAntigravityGemini(body, `${model}-high`).generationConfig)
      .toMatchObject({ thinkingConfig: { thinkingLevel: 'high', includeThoughts: true } })
  })

  it('preserves a native numeric budget before Gemini 3 sanitization strips it', () => {
    const body = { generationConfig: { thinkingConfig: { thinkingBudget: 0, includeThoughts: false } } }
    expect(prepareAntigravityGemini(body, 'gemini-3.8-flash').generationConfig)
      .toEqual({ thinkingConfig: { thinkingLevel: 'low', includeThoughts: false } })
    expect(body.generationConfig.thinkingConfig.thinkingBudget).toBe(0)
  })

  it('keeps Gemini 2.5 on numeric budgets and preserves snake-case generation envelopes', () => {
    expect(messagesToGemini({ messages: [], thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } }, 'gemini-2.5-pro').generationConfig)
      .toMatchObject({ thinkingConfig: { thinkingBudget: 8192, includeThoughts: true } })
    const result = prepareAntigravityGemini({ generation_config: { thinking_config: { thinking_level: 'low' } } }, model)
    expect(result).not.toHaveProperty('generationConfig')
    expect(result.generation_config).toMatchObject({ thinkingConfig: { thinkingLevel: 'low' } })
  })

  it('does not silently increase an explicit effort when the account only has a higher variant', () => {
    expect(() => resolveAntigravityModel(model, [{ id: `${model}-high` }], 'low', false, true))
      .toThrow(expect.objectContaining({ code: 'unsupported_reasoning_effort', statusCode: 400 }))
    expect(resolveAntigravityModel(model, [{ id: `${model}-tiered` }], 'low', false, true)).toBe(`${model}-tiered`)
  })

  it('rejects unsupported effort and invalid Messages budgets locally', () => {
    expect(() => prepareAntigravityGemini({ generationConfig: { thinkingConfig: { thinkingLevel: 'typo' } } }, model))
      .toThrow(expect.objectContaining({ code: 'unsupported_reasoning_effort', statusCode: 400 }))
    expect(() => messagesToGemini({ messages: [], output_config: { effort: 'typo' } }, model))
      .toThrow(expect.objectContaining({ code: 'unsupported_reasoning_effort', statusCode: 400 }))
    expect(() => messagesToGemini({ messages: [], thinking: { type: 'enabled', budget_tokens: -1 } }, model))
      .toThrow(expect.objectContaining({ code: 'invalid_thinking_budget', statusCode: 400 }))
  })
})
