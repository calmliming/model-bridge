import { describe, expect, it } from 'vitest'
import { createStreamParser } from './usage'

function parse(events: unknown[]) {
  const parser = createStreamParser()
  for (const event of events) parser.feed(event)
  return parser.result()
}

describe('Claude stream usage parser', () => {
  it('keeps official stream counts from message_start and the final output', () => {
    expect(parse([
      { type: 'message_start', message: { usage: { input_tokens: 120, cache_read_input_tokens: 900, cache_creation_input_tokens: 40, output_tokens: 1 } } },
      { type: 'message_delta', delta: { stop_reason: null }, usage: { output_tokens: 30 } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 80 } },
    ])).toEqual({ inputTokens: 120, outputTokens: 80, reasoningTokens: 0, cacheCreateTokens: 40, cacheReadTokens: 900 })
  })

  it('takes converted-stream input and cache counts that only arrive in message_delta', () => {
    expect(parse([
      { type: 'message_start', message: { usage: { input_tokens: 0, output_tokens: 0 } } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0 } },
    ])).toEqual({ inputTokens: 1200, outputTokens: 80, reasoningTokens: 0, cacheCreateTokens: 0, cacheReadTokens: 3000 })
  })

  it('lets cumulative delta counts supersede message_start', () => {
    expect(parse([
      { type: 'message_start', message: { usage: { input_tokens: 100, cache_read_input_tokens: 10 } } },
      { type: 'message_delta', usage: { input_tokens: 150, cache_read_input_tokens: 20, output_tokens: 5 } },
    ])).toMatchObject({ inputTokens: 150, cacheReadTokens: 20, outputTokens: 5 })
  })

  it('ignores zero placeholders after a positive count', () => {
    expect(parse([
      { type: 'message_start', message: { usage: { input_tokens: 100, cache_read_input_tokens: 10 } } },
      { type: 'message_delta', usage: { input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 7 } },
    ])).toMatchObject({ inputTokens: 100, cacheReadTokens: 10, outputTokens: 7 })
  })

  it('does not subtract late cache buckets from an earlier input count', () => {
    expect(parse([
      { type: 'message_start', message: { usage: { input_tokens: 4200 } } },
      { type: 'message_delta', usage: { cache_read_input_tokens: 3000, output_tokens: 9 } },
    ])).toMatchObject({ inputTokens: 4200, cacheReadTokens: 3000, outputTokens: 9 })
  })

  it('skips malformed delta counts', () => {
    expect(parse([
      { type: 'message_start', message: { usage: { input_tokens: 50 } } },
      { type: 'message_delta', usage: { input_tokens: -1, output_tokens: '12', cache_read_input_tokens: Number.NaN } },
    ])).toMatchObject({ inputTokens: 50, outputTokens: 0, cacheReadTokens: 0 })
  })
})
