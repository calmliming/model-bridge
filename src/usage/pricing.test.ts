import { describe, expect, it } from 'vitest'
import { emptyUsage } from '../providers/types'
import { estimateCost, resolvePrice } from './pricing'

// resolvePrice() returns the built-in tier before loadPricing() runs, so these
// exercise the pricing math without a database. They pin the gpt-5.6 family
// (Sol/Terra/Luna) list prices added for sub2api v0.1.146 parity.
describe('openai gpt-5.6 pricing', () => {
  it('prices the Sol flagship at 5 / 30 with a 1.25× cache-write rate', () => {
    expect(resolvePrice('openai', 'gpt-5.6-sol')).toMatchObject({
      input: 5,
      output: 30,
      cacheWrite: 6.25,
      cacheRead: 0.5,
    })
  })

  it('prices the Terra workhorse at 2.5 / 15 with a 1.25× cache-write rate', () => {
    expect(resolvePrice('openai', 'gpt-5.6-terra')).toMatchObject({
      input: 2.5,
      output: 15,
      cacheWrite: 3.125,
      cacheRead: 0.25,
    })
  })

  it('prices the Luna budget tier at 1 / 6 with 1.25× write and 0.1× read rates', () => {
    expect(resolvePrice('openai', 'gpt-5.6-luna')).toMatchObject({
      input: 1,
      output: 6,
      cacheWrite: 1.25,
      cacheRead: 0.1,
    })
  })

  it('leaves gpt-5.5 / gpt-5.4 cache writes unbilled (only 5.6 charges them)', () => {
    expect(resolvePrice('openai', 'gpt-5.5')).toMatchObject({ input: 5, cacheWrite: 0 })
    expect(resolvePrice('openai', 'gpt-5.4')).toMatchObject({ input: 2.5, cacheWrite: 0 })
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

  it('bills gpt-5.6 cache-write tokens at 1.25× input (Sol: 1M cache write = $6.25)', () => {
    const cost = estimateCost('openai', 'gpt-5.6-sol', {
      ...emptyUsage(),
      cacheCreateTokens: 1_000_000,
    })
    expect(cost).toBeCloseTo(6.25)
  })
})

describe('grok (xAI) pricing', () => {
  it('prices the grok-4.5 flagship at 2 / 6 with a 0.5× cached-read rate', () => {
    expect(resolvePrice('grok', 'grok-4.5')).toMatchObject({ input: 2, output: 6, cacheRead: 0.5 })
  })

  it('prices grok-4.3 at 1.25 / 2.5', () => {
    expect(resolvePrice('grok', 'grok-4.3')).toMatchObject({ input: 1.25, output: 2.5, cacheRead: 0.2 })
  })

  it('prices the grok-build coding tier at 1 / 2', () => {
    expect(resolvePrice('grok', 'grok-build-0.1')).toMatchObject({ input: 1, output: 2 })
  })

  it('defaults a bare grok to the flagship rate', () => {
    expect(resolvePrice('grok', 'grok')).toMatchObject({ input: 2, output: 6 })
  })

  it('routes grok through the sub2api aggregator too', () => {
    expect(resolvePrice('sub2api', 'grok-4.3')).toMatchObject({ input: 1.25, output: 2.5 })
  })
})

describe('OpenAI image pricing', () => {
  it('uses gpt-image-2 text and image token rates', () => {
    expect(resolvePrice('openai', 'gpt-image-2')).toMatchObject({
      input: 5,
      output: 10,
      cacheRead: 1.25,
      imageInput: 8,
      imageOutput: 30,
    })
  })

  it('prices image tokens separately from text tokens', () => {
    expect(estimateCost('openai', 'gpt-image-2', {
      ...emptyUsage(),
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      imageInputTokens: 1_000_000,
      imageOutputTokens: 1_000_000,
      imageModel: 'gpt-image-2',
    })).toBe(53)
  })

  it('keeps Responses text on the main model and image output on the tool model', () => {
    expect(estimateCost('openai', 'gpt-5.4', {
      ...emptyUsage(),
      inputTokens: 1_000_000,
      imageOutputTokens: 1_000_000,
      imageModel: 'gpt-image-2',
    })).toBe(32.5)
  })
})
