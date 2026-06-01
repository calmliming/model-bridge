import { describe, expect, it } from 'vitest'
import { isAllowedModel } from './modelAllowlist'

describe('isAllowedModel', () => {
  it('keeps empty allow-lists unrestricted', () => {
    expect(isAllowedModel('gpt-5.5', null)).toBe(true)
    expect(isAllowedModel('gpt-5.5', [])).toBe(true)
  })

  it('matches exact model names case-insensitively', () => {
    expect(isAllowedModel('GPT-5.5', ['gpt-5.5'])).toBe(true)
    expect(isAllowedModel('gpt-5.4', ['gpt-5.5'])).toBe(false)
  })

  it('supports wildcard patterns', () => {
    expect(isAllowedModel('gpt-5.5', ['gpt-5*'])).toBe(true)
    expect(isAllowedModel('deepseek-v4-pro', ['deepseek-*'])).toBe(true)
    expect(isAllowedModel('claude-sonnet-4-5', ['gpt-*', 'deepseek-*'])).toBe(false)
  })
})
