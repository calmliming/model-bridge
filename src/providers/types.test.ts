import { describe, expect, it } from 'vitest'
import { usageWithCachedInput } from './types'

describe('usageWithCachedInput', () => {
  it('splits cached input out of total input tokens', () => {
    expect(usageWithCachedInput(100, 20, 30)).toEqual({
      inputTokens: 70,
      outputTokens: 20,
      cacheCreateTokens: 0,
      cacheReadTokens: 30,
    })
  })

  it('clamps cached input to the total input token count', () => {
    expect(usageWithCachedInput(10, 5, 20)).toEqual({
      inputTokens: 0,
      outputTokens: 5,
      cacheCreateTokens: 0,
      cacheReadTokens: 10,
    })
  })
})
