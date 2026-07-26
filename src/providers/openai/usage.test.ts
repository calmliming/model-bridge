import { describe, expect, it } from 'vitest'
import { createStreamParser, parseJsonUsage } from './usage'

describe('OpenAI usage parsing', () => {
  it('stores only uncached input as inputTokens and cached input as cacheReadTokens', () => {
    expect(
      parseJsonUsage({
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          input_tokens_details: { cached_tokens: 35 },
        },
      }),
    ).toEqual({
      inputTokens: 65,
      outputTokens: 20,
      reasoningTokens: 0,
      cacheCreateTokens: 0,
      cacheReadTokens: 35,
    })
  })

  it('carves gpt-5.6 cache writes out of total input into cacheCreateTokens', () => {
    // input_tokens is the total: 40 fresh + 35 cache read + 25 cache write.
    expect(
      parseJsonUsage({
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          input_tokens_details: { cached_tokens: 35, cache_write_tokens: 25 },
        },
      }),
    ).toEqual({
      inputTokens: 40,
      outputTokens: 20,
      reasoningTokens: 0,
      cacheCreateTokens: 25,
      cacheReadTokens: 35,
    })
  })

  it('reports reasoning_tokens from output_tokens_details', () => {
    expect(
      parseJsonUsage({
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          output_tokens_details: { reasoning_tokens: 18 },
        },
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      reasoningTokens: 18,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
    })
  })

  it('parses cached input from streamed response.completed events', () => {
    const parser = createStreamParser()
    parser.feed({
      type: 'response.completed',
      response: {
        usage: {
          input_tokens: 12,
          output_tokens: 3,
          input_tokens_details: { cached_tokens: 5 },
        },
      },
    })

    expect(parser.result()).toEqual({
      inputTokens: 7,
      outputTokens: 3,
      reasoningTokens: 0,
      cacheCreateTokens: 0,
      cacheReadTokens: 5,
    })
  })

  it('separates image tokens and records image tool metadata', () => {
    expect(parseJsonUsage({
      response: {
        usage: {
          input_tokens: 20,
          output_tokens: 100,
          input_tokens_details: { image_tokens: 8 },
          output_tokens_details: { image_tokens: 90 },
        },
        tools: [{ type: 'image_generation', model: 'gpt-image-2', size: '1024x1024' }],
        output: [{ type: 'image_generation_call', result: 'aGVsbG8=' }],
      },
    })).toEqual({
      inputTokens: 12,
      outputTokens: 10,
      reasoningTokens: 0,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
      imageInputTokens: 8,
      imageOutputTokens: 90,
      imageCount: 1,
      imageSize: '1024x1024',
      imageModel: 'gpt-image-2',
    })
  })
})
