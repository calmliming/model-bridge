import { describe, expect, it } from 'vitest'
import { parseJsonUsage } from './usage'

describe('Gemini usage parsing', () => {
  it('splits cachedContentTokenCount out of promptTokenCount', () => {
    expect(
      parseJsonUsage({
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 20,
          cachedContentTokenCount: 40,
        },
      }),
    ).toEqual({
      inputTokens: 60,
      outputTokens: 20,
      reasoningTokens: 0,
      cacheCreateTokens: 0,
      cacheReadTokens: 40,
    })
  })

  it('reports thoughtsTokenCount as reasoning tokens', () => {
    expect(
      parseJsonUsage({
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 20,
          thoughtsTokenCount: 15,
        },
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      reasoningTokens: 15,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
    })
  })
})
