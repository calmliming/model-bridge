import { describe, expect, it } from 'vitest'
import { isRetiredOpenAISubscriptionModel, validateOpenAISubscriptionModel } from './models'

describe('GPT-5.5 subscription retirement', () => {
  it.each(['gpt-5.5', 'gpt-5-5', ' GPT-5.5 ', 'gpt-5.5-2026-04-23', 'GPT-5-5-high'])
  ('rejects retired spelling %s', model => {
    expect(isRetiredOpenAISubscriptionModel(model)).toBe(true)
    expect(() => validateOpenAISubscriptionModel(model)).toThrow(expect.objectContaining({ statusCode: 404, code: 'model_not_found' }))
  })
  it.each(['gpt-5.50', 'gpt-5.6-sol', 'gpt-6.1-sol', 'gpt-image-2.5', 'custom-gpt-5.5', 'unknown', ''])
  ('preserves other models: %s', model => {
    expect(isRetiredOpenAISubscriptionModel(model)).toBe(false)
    expect(validateOpenAISubscriptionModel(model)).toBe(model)
  })
})
