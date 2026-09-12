import { describe, expect, it } from 'vitest'
import { createStreamParser } from './usage'

describe('Gemini response signals', () => {
  it('retains embedded upstream errors and partial usage even after a later normal frame', () => {
    const parser = createStreamParser()
    parser.feed({ candidates: [{ content: { parts: [{ text: 'partial' }] } }], usageMetadata: { promptTokenCount: 12 } })
    parser.feed({ error: { code: 503, status: 'UNAVAILABLE', message: 'Try later' } })
    parser.feed({ candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3 } })
    expect(parser.failure()).toEqual({ code: 'gemini_upstream_UNAVAILABLE', message: 'Try later' })
    expect(parser.result()).toMatchObject({ inputTokens: 12, outputTokens: 3 })
  })
  it.each(['STOP', 'MAX_TOKENS', 'OTHER', 'MALFORMED_FUNCTION_CALL', 'UNEXPECTED_TOOL_CALL', 'NO_IMAGE'])('treats %s as a model result', finishReason => {
    const parser = createStreamParser()
    parser.feed({ response: { candidates: [{ finishReason }] } })
    expect(parser.failure()).toBeNull()
  })
  it('classifies policy separately and only uses the primary candidate', () => {
    const parser = createStreamParser()
    parser.feed({ candidates: [{ index: 1, finishReason: 'SAFETY' }, { index: 0, finishReason: 'STOP' }] })
    expect(parser.failure()).toBeNull()
    parser.feed({ promptFeedback: { blockReason: 'BLOCKLIST' } })
    expect(parser.failure()?.code).toBe('gemini_policy_BLOCKLIST')
  })
  it('detects empty results while accepting countTokens responses', () => {
    const parser = createStreamParser()
    parser.feed({ candidates: [], usageMetadata: { promptTokenCount: 4 } })
    expect(parser.failure()?.code).toBe('gemini_empty_response')
    parser.feed({ totalTokens: 4 })
    expect(parser.failure()).toBeNull()
  })
})
