import { describe, expect, it } from 'vitest'
import { mapModel, mapResponsesModel } from './converter'

describe('mapModel', () => {
  it('rewrites non-DeepSeek model names to V4.1 Flash', () => {
    expect(mapModel('gpt-5.5')).toBe('deepseek-flash')
    expect(mapModel('gpt-4o')).toBe('deepseek-flash')
    expect(mapModel('o3-mini')).toBe('deepseek-flash')
  })

  it('maps legacy aliases while preserving concrete DeepSeek names', () => {
    expect(mapModel('deepseek-v4-pro')).toBe('deepseek-v4-pro')
    expect(mapModel('deepseek-flash')).toBe('deepseek-flash')
    expect(mapModel('deepseek-v4-flash')).toBe('deepseek-v4-flash')
    expect(mapModel('deepseek-v4-flash-vision-exp')).toBe('deepseek-v4-flash-vision-exp')
    expect(mapModel('deepseek-chat')).toBe('deepseek-flash')
    expect(mapModel('deepseek-reasoner')).toBe('deepseek-flash')
    expect(mapModel('deepseek-anything-else')).toBe('deepseek-anything-else')
  })

  it('falls back to V4.1 Flash for empty or non-string input', () => {
    expect(mapModel('')).toBe('deepseek-flash')
    expect(mapModel(undefined)).toBe('deepseek-flash')
    expect(mapModel(123)).toBe('deepseek-flash')
  })
})

describe('mapResponsesModel', () => {
  it('preserves supported Responses models and defaults to V4.1 Flash', () => {
    expect(mapResponsesModel('deepseek-flash')).toBe('deepseek-flash')
    expect(mapResponsesModel('deepseek-v4-flash')).toBe('deepseek-v4-flash')
    expect(mapResponsesModel('deepseek-v4-pro')).toBe('deepseek-v4-pro')
    expect(mapResponsesModel('deepseek-v4-flash-vision-exp')).toBe('deepseek-v4-flash-vision-exp')
    expect(mapResponsesModel('deepseek-chat')).toBe('deepseek-flash')
    expect(mapResponsesModel('deepseek-reasoner')).toBe('deepseek-flash')
    expect(mapResponsesModel('gpt-5.5')).toBe('deepseek-flash')
    expect(mapResponsesModel(undefined)).toBe('deepseek-flash')
  })
})
