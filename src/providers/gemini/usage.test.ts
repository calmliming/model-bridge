import { describe, expect, it } from 'vitest'
import { createStreamParser, parseJsonUsage } from './usage'

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

  it('includes separately reported thought tokens in billable output', () => {
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
      outputTokens: 35,
      reasoningTokens: 15,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
    })
  })

  it('retains reported fields across partial snapshots and empty metadata', () => {
    const parser = createStreamParser()
    parser.feed({ usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 40,
      candidatesTokenCount: 20, thoughtsTokenCount: 5 } })
    parser.feed({ usageMetadata: { candidatesTokenCount: 25 } })
    parser.feed({ usageMetadata: {} })
    parser.feed({ usageMetadata: { promptTokenCount: undefined, cachedContentTokenCount: null,
      candidatesTokenCount: -1, thoughtsTokenCount: NaN } })
    parser.feed({ usageMetadata: { promptTokenCount: Infinity, thoughtsTokenCount: '10' } })
    expect(parser.result()).toEqual({ inputTokens: 60, outputTokens: 30, reasoningTokens: 5,
      cacheCreateTokens: 0, cacheReadTokens: 40 })
  })

  it('normalizes cache and thought counts after merging their raw snapshots', () => {
    const parser = createStreamParser()
    parser.feed({ usageMetadata: { cachedContentTokenCount: 40, thoughtsTokenCount: 5 } })
    parser.feed({ usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } })
    expect(parser.result()).toMatchObject({ inputTokens: 60, outputTokens: 25, reasoningTokens: 5, cacheReadTokens: 40 })
    parser.feed({ usageMetadata: { cachedContentTokenCount: 60, thoughtsTokenCount: 10 } })
    expect(parser.result()).toMatchObject({ inputTokens: 40, outputTokens: 30, reasoningTokens: 10, cacheReadTokens: 60 })
  })

  it('honors explicitly reported zeros instead of retaining older counts', () => {
    const parser = createStreamParser()
    parser.feed({ usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 40,
      candidatesTokenCount: 20, thoughtsTokenCount: 5 } })
    parser.feed({ usageMetadata: { promptTokenCount: 0, cachedContentTokenCount: 0,
      candidatesTokenCount: 0, thoughtsTokenCount: 0 } })
    expect(parser.result()).toEqual({ inputTokens: 0, outputTokens: 0, reasoningTokens: 0,
      cacheCreateTokens: 0, cacheReadTokens: 0 })
  })

  it('retains cache-only blocked usage without negative input tokens', () => {
    const blocked = { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' },
      usageMetadata: { cachedContentTokenCount: 200 } }
    expect(parseJsonUsage(blocked)).toMatchObject({ inputTokens: 0, cacheReadTokens: 200 })
    const parser = createStreamParser()
    parser.feed(blocked)
    parser.feed({ usageMetadata: {} })
    expect(parser.result()).toMatchObject({ inputTokens: 0, cacheReadTokens: 200 })
  })
})
