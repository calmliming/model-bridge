import { describe, expect, it } from 'vitest'
import { mapModel, mapResponsesModel } from './converter'

describe('mapModel', () => {
  it('rewrites non-DeepSeek model names to V4 Pro', () => {
    expect(mapModel('gpt-5.5')).toBe('deepseek-v4-pro')
    expect(mapModel('gpt-4o')).toBe('deepseek-v4-pro')
    expect(mapModel('o3-mini')).toBe('deepseek-v4-pro')
  })

  it('maps legacy aliases while preserving concrete DeepSeek names', () => {
    expect(mapModel('deepseek-v4-pro')).toBe('deepseek-v4-pro')
    expect(mapModel('deepseek-chat')).toBe('deepseek-v4-flash')
    expect(mapModel('deepseek-reasoner')).toBe('deepseek-v4-flash')
    expect(mapModel('deepseek-anything-else')).toBe('deepseek-anything-else')
  })

  it('falls back to V4 Pro for empty or non-string input', () => {
    expect(mapModel('')).toBe('deepseek-v4-pro')
    expect(mapModel(undefined)).toBe('deepseek-v4-pro')
    expect(mapModel(123)).toBe('deepseek-v4-pro')
  })
})

describe('mapResponsesModel', () => {
  it('preserves supported Responses models and defaults to V4 Flash', () => {
    expect(mapResponsesModel('deepseek-v4-flash')).toBe('deepseek-v4-flash')
    expect(mapResponsesModel('deepseek-v4-pro')).toBe('deepseek-v4-pro')
    expect(mapResponsesModel('gpt-5.5')).toBe('deepseek-v4-flash')
    expect(mapResponsesModel(undefined)).toBe('deepseek-v4-flash')
  })
})
