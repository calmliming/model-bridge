import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parsePricingOverrides, reloadPricingOverrides, startPricingOverrideReload } from './pricingOverrides'
import { resolvePrice, resolveUsagePrice, estimateCost } from './pricing'
import { emptyUsage } from '../providers/types'

let directory: string
let file: string
const base = { input: 2, output: 4, cacheRead: 0.2, cacheWrite: 2.5 }

async function writeRules(rules: unknown[]) {
  await writeFile(file, JSON.stringify({ version: 1, rules }))
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'model-bridge-pricing-'))
  file = join(directory, 'prices.json')
  await writeRules([])
  await reloadPricingOverrides(file)
})
afterEach(async () => {
  vi.useRealTimers()
  await writeRules([])
  await reloadPricingOverrides(file)
  await rm(directory, { recursive: true, force: true })
})

describe('pricing override file', () => {
  it('prefers exact overrides over wildcard rules and built-in prices', async () => {
    await writeRules([
      { provider: 'openai', model: 'gpt-*', price: base },
      { provider: 'openai', model: 'gpt-6-astra', price: { ...base, input: 3 } },
    ])
    await reloadPricingOverrides(file)
    expect(resolvePrice('openai', 'gpt-6-astra')?.input).toBe(3)
    expect(resolvePrice('openai', 'gpt-5.4')?.input).toBe(2)
    expect(resolvePrice('sub2api', 'gpt-6-astra')?.input).toBe(10)
  })
  it('keeps the last valid prices after a malformed reload', async () => {
    await writeRules([{ provider: 'openai', model: 'gpt-6-astra', price: base }])
    await reloadPricingOverrides(file)
    await writeFile(file, '{ incomplete')
    await expect(reloadPricingOverrides(file)).rejects.toThrow()
    expect(resolvePrice('openai', 'gpt-6-astra')).toEqual(base)
  })
  it('rejects negative prices, duplicate rules, and misspelled fields', () => {
    const encode = (rules: unknown[]) => JSON.stringify({ version: 1, rules })
    const rule = { provider: 'openai', model: 'gpt-6-astra', price: base }
    expect(() => parsePricingOverrides(encode([{ ...rule, price: { ...base, input: -1 } }]))).toThrow()
    expect(() => parsePricingOverrides(encode([rule, rule]))).toThrow('duplicate')
    expect(() => parsePricingOverrides(encode([{ ...rule, pricing: base }]))).toThrow()
  })
  it('reloads changed files periodically and drains a pending reload on stop', async () => {
    vi.useFakeTimers()
    const stop = await startPricingOverrideReload(file)
    try {
      await writeRules([{ provider: 'openai', model: 'gpt-6-astra', price: base }])
      await vi.advanceTimersByTimeAsync(30_000)
    } finally { await stop() }
    expect(resolvePrice('openai', 'gpt-6-astra')).toEqual(base)
  })
  it('supports explicit tier and reasoning prices with opt-out from long-context multipliers', async () => {
    await writeRules([{ provider: 'openai', model: 'gpt-6-astra', price: base,
      longContext: null, serviceTierMultipliers: { priority: 1, ultrafast: 3 },
      effortPrices: { high: { ...base, output: 6 } },
    }])
    await reloadPricingOverrides(file)
    const usage = { ...emptyUsage(), inputTokens: 300_000, outputTokens: 100,
      serviceTier: 'ultrafast', reasoningEffort: 'high' }
    expect(resolveUsagePrice('openai', 'gpt-6-astra', usage)).toMatchObject({ input: 6, output: 18 })
    expect(estimateCost('openai', 'gpt-6-astra', usage)).toBe(1.8018)
  })
})

describe('Astra default billing', () => {
  it('includes cached tokens when checking the long-context threshold', () => {
    const atBoundary = { ...emptyUsage(), inputTokens: 172_000, cacheReadTokens: 100_000 }
    expect(resolveUsagePrice('openai', 'gpt-6-astra', atBoundary)).toMatchObject({ input: 10, output: 50, cacheRead: 1 })
    expect(resolveUsagePrice('openai', 'gpt-6-astra', { ...atBoundary, cacheCreateTokens: 1 }))
      .toMatchObject({ input: 20, output: 75, cacheRead: 2, cacheWrite: 25 })
  })
  it('uses the actual upstream tier and combines it with the long-context rate once', () => {
    const usage = { ...emptyUsage(), inputTokens: 300_000, outputTokens: 100, serviceTier: 'priority' }
    expect(estimateCost('openai', 'gpt-6-astra', usage)).toBe(12.015)
    expect(estimateCost('openai', 'gpt-6-astra', { ...usage, serviceTier: 'default' })).toBe(6.0075)
    expect(estimateCost('sub2api', 'gpt-6-astra', usage)).toBe(12.015)
  })
})
