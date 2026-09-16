import { describe, expect, it } from 'vitest'
import { mapModel, mapResponsesModel, isForwardableDeepseekModel, DeepseekRequestError } from './converter'

describe('mapModel', () => {
  it.each([
    ['deepseek-flash[1m]', 'deepseek-flash'],
    ['  DeepSeek-FLASH[1M][1m]  ', 'deepseek-flash'],
    ['DEEPSEEK-V4-PRO', 'deepseek-v4-pro'],
    ['deepseek-v4-pro[1m]', 'deepseek-v4-pro'],
    ['deepseek-chat[1m]', 'deepseek-flash'],
  ])('normalizes client model %s for every protocol', (input, expected) => {
    expect(mapModel(input)).toBe(expected)
    expect(mapResponsesModel(input)).toBe(expected)
    expect(isForwardableDeepseekModel(input)).toBe(true)
  })

  it.each(['DEEPSEEK-TYPO[1m]', 'deepseek-flash[2m]', 'deepseek-flash[1m]-typo'])(
    'rejects unsupported names after normalization: %s', (input) => {
      expect(() => mapModel(input)).toThrow(DeepseekRequestError)
      expect(() => mapResponsesModel(input)).toThrow(DeepseekRequestError)
      expect(isForwardableDeepseekModel(input)).toBe(false)
    }
  )

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
  })

  it('rejects unknown deepseek-* names instead of forwarding them upstream', () => {
    expect(() => mapModel('deepseek-anything-else')).toThrowError(/Unsupported DeepSeek model/)
    // Pricing knows these names for forward compatibility, but the upstream
    // does not serve them yet, so they must be rejected at the gateway.
    expect(() => mapModel('deepseek-v4.1-pro')).toThrow(DeepseekRequestError)
    expect(() => mapModel('deepseek-v4-flash-thinking')).toThrow(/Unsupported DeepSeek model/)
    expect(() => mapModel('deepseek-v5')).toThrow(DeepseekRequestError)
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

  it('agrees with mapModel on every input, including rejected names', () => {
    // A laxer fallback here once let the same model string 400 on
    // /v1/messages while being silently served by Flash on /v1/responses.
    const inputs: unknown[] = [
      'deepseek-flash',
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'deepseek-v4-flash-vision-exp',
      'deepseek-chat',
      'deepseek-reasoner',
      'deepseek-anything-else',
      'deepseek-v4.1-pro',
      'gpt-5.5',
      '',
      undefined,
      123,
    ]
    for (const input of inputs) {
      let chat: unknown
      let responses: unknown
      try {
        chat = mapModel(input)
      } catch (e) {
        chat = e
      }
      try {
        responses = mapResponsesModel(input)
      } catch (e) {
        responses = e
      }
      if (chat instanceof Error) {
        expect(responses, `input ${String(input)}`).toBeInstanceOf(DeepseekRequestError)
      } else {
        expect(responses, `input ${String(input)}`).toBe(chat)
      }
    }
  })
})
