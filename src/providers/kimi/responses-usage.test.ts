import { describe, expect, it } from 'vitest'
import { parseJsonUsage } from './responses-usage'

describe('Kimi Responses usage parsing', () => {
  it('splits cached input out of total input tokens', () => {
    expect(
      parseJsonUsage({
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          input_tokens_details: { cached_tokens: 25 },
        },
      }),
    ).toEqual({
      inputTokens: 75,
      outputTokens: 20,
      reasoningTokens: 0,
      cacheCreateTokens: 0,
      cacheReadTokens: 25,
    })
  })
})
