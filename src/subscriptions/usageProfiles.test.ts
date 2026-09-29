import { describe, expect, it } from 'vitest'
import { goUsageLimits, subscriptionModelMultiplier, subscriptionUsageBands } from './usageProfiles'

describe('OpenCode Go benchmark', () => {
  it.each([
    [10, 12000, 30000, 60000],
    [30, 36000, 90000, 180000],
    [100, 120000, 300000, 600000],
  ])('scales our $%s tier from the Go allowance, with 20%% and 50%% windows', (price, fiveHour, weekly, monthly) => {
    expect(goUsageLimits(price)).toEqual({ fiveHour, weekly, monthly })
    expect(fiveHour / monthly).toBe(0.2)
    expect(weekly / monthly).toBe(0.5)
  })
  it.each([
    ['deepseek-flash', 1], ['deepseek-v4.1-flash', 1], ['deepseek-v4-flash', 2],
    ['deepseek-v4-flash-vision-exp', 4], ['deepseek-v4-pro', 4],
    ['glm-5.3-flash', 1], ['glm-5.3', 4], ['glm-5.2', 1],
    ['kimi-k2.7-code', 1], ['kimi-k3', 4],
    ['mimo-v2.5', 1], ['mimo-v2.5-pro', 4], ['mimo-v2.6-flash', 1], ['mimo-v2.6-pro', 4],
    ['MiniMax-M3', 1], ['qwen3.7-plus', 1], ['qwen3.8-flash', 2], ['qwen3.8-max', 4],
    ['gpt-6-luna', 4], ['grok-4.7', 4], ['claude-sonnet-5', 4], ['unlisted-model', 4],
  ])('meters %s at %sx without matching a more general variant first', (model, multiplier) => {
    expect(subscriptionModelMultiplier('opencode-go', model)).toBe(multiplier)
    expect(subscriptionModelMultiplier('base', model)).toBe(1)
  })
  it('converts shared point limits to model-specific reference allowances', () => {
    expect(subscriptionUsageBands('opencode-go', 60000).map(band => band.monthlyReferenceUsd)).toEqual([60, 30, 15])
    expect(subscriptionUsageBands('opencode-go', 180000).map(band => band.monthlyReferenceUsd)).toEqual([180, 90, 45])
    expect(subscriptionUsageBands('base', 30000)).toEqual([])
  })
  it('mixes model consumption into the same percentage budget', () => {
    const points = 1000 * subscriptionModelMultiplier('opencode-go', 'deepseek-flash')
      + 1000 * subscriptionModelMultiplier('opencode-go', 'kimi-k3')
    expect(points / 60000).toBeCloseTo(1 / 60 + 1 / 15)
  })
})
