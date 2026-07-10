import { describe, expect, it } from 'vitest'
import { emptyUsage } from '../providers/types'
import { estimateCost, resolvePrice } from './pricing'

// resolvePrice() returns the built-in tier before loadPricing() runs, so these
// exercise the pricing math without a database. They pin the gpt-5.6 family
// (Sol/Terra/Luna) list prices added for sub2api v0.1.146 parity.
describe('openai gpt-5.6 pricing', () => {
  it('prices the Sol flagship at the gpt-5.5 rate (5 / 30)', () => {
    expect(resolvePrice('openai', 'gpt-5.6-sol')).toMatchObject({ input: 5, output: 30 })
  })

  it('prices the Terra workhorse at the gpt-5.4 rate (2.5 / 15)', () => {
    expect(resolvePrice('openai', 'gpt-5.6-terra')).toMatchObject({ input: 2.5, output: 15 })
  })

  it('prices the Luna budget tier at 1 / 6 with a 0.1× cached-read rate', () => {
    expect(resolvePrice('openai', 'gpt-5.6-luna')).toMatchObject({
      input: 1,
      output: 6,
      cacheWrite: 0,
      cacheRead: 0.1,
    })
  })

  it('defaults a bare gpt-5.6 to the Sol flagship rate', () => {
    expect(resolvePrice('openai', 'gpt-5.6')).toMatchObject({ input: 5, output: 30 })
  })

  it('still falls back to the gpt-5 base tier for other gpt versions', () => {
    expect(resolvePrice('openai', 'gpt-5.9')).toMatchObject({ input: 1.25, output: 10 })
  })

  it('routes gpt-5.6 through the sub2api provider too', () => {
    expect(resolvePrice('sub2api', 'gpt-5.6-luna')).toMatchObject({ input: 1, output: 6 })
  })

  it('estimates cost from token usage (Luna: 1M in + 1M out = $7)', () => {
    const cost = estimateCost('openai', 'gpt-5.6-luna', {
      ...emptyUsage(),
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    })
    expect(cost).toBeCloseTo(7)
  })
})
