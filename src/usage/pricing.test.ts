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

  it('uses the dedicated Codex Spark price card', () => {
    expect(resolvePrice('openai', 'gpt-5.3-codex-spark')).toMatchObject({
      input: 1.75,
      output: 14,
      cacheRead: 0.175,
    })
    expect(resolvePrice('openai', 'gpt-5.3-codex-spark-high')).toMatchObject({
      input: 1.75,
      output: 14,
    })
    expect(resolvePrice('sub2api', 'gpt-5.3-codex-spark')).toMatchObject({
      input: 1.75,
      output: 14,
      cacheRead: 0.175,
    })
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
  it('prices the grok-4.5 flagship at 2 / 6 with a 0.3× cached-read rate', () => {
    expect(resolvePrice('grok', 'grok-4.5')).toMatchObject({ input: 2, output: 6, cacheRead: 0.3 })
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

  it('prices Grok 4.6 and its latest alias at the upstream cache-read rate', () => {
    expect(resolvePrice('grok', 'grok-4.6')).toMatchObject({ input: 2, output: 6, cacheRead: 0.5 })
    expect(resolvePrice('grok', 'grok-4.6-latest')).toMatchObject({ input: 2, output: 6, cacheRead: 0.5 })
    expect(resolvePrice('grok', 'grok-4.5')).toMatchObject({ input: 2, output: 6, cacheRead: 0.3 })
  })
})

describe('Kimi Code pricing', () => {
  it('prices Kimi Code K3 aliases as the Kimi K3 tier', () => {
    for (const model of ['k3', 'k3-256k', 'kimi-code/k3']) {
      expect(resolvePrice('sub2api', model)).toMatchObject({ input: 2.8, output: 14 })
    }
  })
})

describe('current Claude pricing', () => {
  it('uses Fable 5.1 cache-read pricing without changing Fable 5', () => {
    expect(resolvePrice('claude', 'claude-fable-5-1')).toMatchObject({
      input: 10,
      output: 50,
      cacheWrite: 12.5,
      cacheRead: 0.25,
    })
    expect(resolvePrice('claude', 'claude-fable-5')).toMatchObject({ cacheRead: 1 })
    expect(resolvePrice('sub2api', 'claude-fable-5-1')).toMatchObject({ cacheRead: 0.25 })
  })

  it('uses Sonnet 5 permanent pricing without repricing older Sonnet models', () => {
    expect(resolvePrice('claude', 'claude-sonnet-5')).toMatchObject({
      input: 2,
      output: 10,
      cacheWrite: 2.5,
      cacheRead: 0.2,
    })
    expect(resolvePrice('claude', 'claude-sonnet-4-6')).toMatchObject({ input: 3, output: 15 })
  })
})

describe('current Google, Xiaomi, GLM, and Qwen pricing', () => {
  it('prices the current Gemini tiers', () => {
    const introductory = Date.parse('2026-09-03T00:00:00Z')
    expect(resolvePrice('gemini', 'gemini-3.8-flash', introductory)).toMatchObject({
      input: 0.75,
      output: 3.75,
      cacheRead: 0.075,
    })
    expect(resolvePrice('gemini', 'gemini-3.6-flash', introductory)).toMatchObject({
      input: 0.75,
      output: 3.75,
      cacheRead: 0.075,
    })
    expect(resolvePrice('gemini', 'gemini-3.1-pro-preview')).toMatchObject({
      input: 2,
      output: 12,
      cacheRead: 0.2,
    })
    expect(resolvePrice('gemini', 'gemini-3.5-flash-lite')).toMatchObject({
      input: 0.3,
      output: 2.5,
      cacheRead: 0.03,
    })
    expect(resolvePrice('gemini', 'gemini-3.5-flash')).toMatchObject({
      input: 1.5,
      output: 9,
      cacheRead: 0.15,
    })
  })

  it('switches frontier Flash models to standard pricing after the promotion', () => {
    const standard = Date.parse('2027-01-01T00:00:00Z')
    expect(resolvePrice('gemini', 'gemini-3.8-flash', standard)).toMatchObject({
      input: 1.5,
      output: 7.5,
      cacheRead: 0.15,
    })
    expect(resolvePrice('gemini', 'gemini-3.6-flash', standard)).toMatchObject({
      input: 1.5,
      output: 7.5,
      cacheRead: 0.15,
    })
  })

  it('uses Xiaomi MiMo V2.5 overseas list prices', () => {
    expect(resolvePrice('xiaomi', 'mimo-v2.5-pro')).toMatchObject({
      input: 0.435,
      output: 0.87,
      cacheRead: 0.0036,
    })
    expect(resolvePrice('xiaomi', 'mimo-v2.5')).toMatchObject({
      input: 0.14,
      output: 0.28,
      cacheRead: 0.0028,
    })
  })

  it('prices the current GLM text and multimodal tiers', () => {
    expect(resolvePrice('zhipu', 'glm-5.3')).toMatchObject({ input: 1.12, output: 3.92, cacheRead: 0.28 })
    expect(resolvePrice('zhipu', 'glm-5.3-flash')).toMatchObject({ input: 0.112, output: 0.392, cacheRead: 0.0322 })
    expect(resolvePrice('zhipu', 'glm-5.2')).toMatchObject({ input: 1.12, output: 3.92, cacheRead: 0.28 })
  })

  it('prices the current Qwen 3.8/3.7 tiers', () => {
    expect(resolvePrice('qwen', 'qwen3.8-max')).toMatchObject({ input: 1.68, output: 5.04, cacheRead: 0.21 })
    expect(resolvePrice('qwen', 'qwen3.7-plus')).toMatchObject({ input: 0.28, output: 1.12, cacheRead: 0.056 })
    expect(resolvePrice('qwen', 'qwen3.7-flash')).toMatchObject({ input: 0.028, output: 0.112, cacheRead: 0.0056 })
  })

  it('routes the same current models through Sub2API pricing', () => {
    expect(resolvePrice('sub2api', 'gemini-3.8-flash', Date.parse('2026-09-03T00:00:00Z'))).toMatchObject({
      input: 0.75,
      output: 3.75,
    })
    expect(resolvePrice('sub2api', 'mimo-v2.5')).toMatchObject({ input: 0.14, output: 0.28 })
    expect(resolvePrice('sub2api', 'glm-5.3')).toMatchObject({ input: 1.12, output: 3.92 })
    expect(resolvePrice('sub2api', 'qwen3.8-max')).toMatchObject({ input: 1.68, output: 5.04 })
  })
})

describe('DeepSeek V4 pricing', () => {
  const beforeSchedule = Date.parse('2026-08-22T15:59:59.999Z')
  const scheduleStarts = Date.parse('2026-08-22T16:00:00Z')
  const peakStarts = Date.parse('2026-08-24T01:00:00Z')

  it('keeps the previous official rates until the schedule takes effect', () => {
    expect(resolvePrice('deepseek', 'deepseek-v4-flash', beforeSchedule)).toMatchObject({
      input: 0.14,
      output: 0.28,
      cacheRead: 0.0028,
    })
    expect(resolvePrice('deepseek', 'deepseek-v4-pro', beforeSchedule)).toMatchObject({
      input: 0.435,
      output: 0.87,
      cacheRead: 0.003625,
    })
  })

  it('switches to off-peak rates at the announced effective instant', () => {
    expect(resolvePrice('deepseek', 'deepseek-v4-flash', scheduleStarts)).toMatchObject({
      input: 0.22,
      output: 0.66,
      cacheRead: 0.007,
    })
    expect(resolvePrice('deepseek', 'deepseek-v4-pro', scheduleStarts)).toMatchObject({
      input: 0.66,
      output: 1.98,
      cacheRead: 0.022,
    })
  })

  it('uses peak rates during both official UTC windows', () => {
    expect(resolvePrice('deepseek', 'deepseek-v4-flash', peakStarts)).toMatchObject({
      input: 0.44,
      output: 1.32,
      cacheRead: 0.014,
    })
    expect(resolvePrice('deepseek', 'deepseek-v4-pro', Date.parse('2026-08-24T06:00:00Z'))).toMatchObject({
      input: 1.32,
      output: 3.96,
      cacheRead: 0.044,
    })
  })

  it('keeps the full Beijing weekend at off-peak rates', () => {
    expect(resolvePrice('deepseek', 'deepseek-v4-flash', Date.parse('2026-08-29T02:00:00Z'))).toMatchObject({
      input: 0.22,
      output: 0.66,
      cacheRead: 0.007,
    })
    expect(resolvePrice('deepseek', 'deepseek-v4-pro', Date.parse('2026-08-30T07:00:00Z'))).toMatchObject({
      input: 0.66,
      output: 1.98,
      cacheRead: 0.022,
    })
  })

  it('treats the end of each peak window as off-peak', () => {
    expect(resolvePrice('deepseek', 'deepseek-v4-flash', Date.parse('2026-08-24T04:00:00Z'))).toMatchObject({
      input: 0.22,
      output: 0.66,
    })
    expect(resolvePrice('deepseek', 'deepseek-v4-pro', Date.parse('2026-08-24T10:00:00Z'))).toMatchObject({
      input: 0.66,
      output: 1.98,
    })
  })

  it('prices legacy aliases and Sub2API DeepSeek models on the same schedule', () => {
    expect(resolvePrice('deepseek', 'deepseek-chat', peakStarts)).toMatchObject({ input: 0.44, output: 1.32 })
    expect(resolvePrice('deepseek', 'deepseek-reasoner', peakStarts)).toMatchObject({ input: 0.44, output: 1.32 })
    expect(resolvePrice('sub2api', 'deepseek-v4-pro', peakStarts)).toMatchObject({ input: 1.32, output: 3.96 })
  })

  it('estimates request cost with the rate active at the supplied timestamp', () => {
    const usage = {
      ...emptyUsage(),
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
    }
    expect(estimateCost('deepseek', 'deepseek-v4-flash', usage, scheduleStarts)).toBe(0.887)
    expect(estimateCost('deepseek', 'deepseek-v4-flash', usage, peakStarts)).toBe(1.774)
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
