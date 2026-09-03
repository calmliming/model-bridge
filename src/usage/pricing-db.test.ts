import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}))

vi.mock('../db/index', () => ({
  pool: { query: mocks.query },
}))

import { loadPricing, resolvePrice } from './pricing'

function priceRow(model: string, input: number, output: number, cacheRead: number, provider = 'deepseek') {
  return {
    provider,
    model,
    input_price: input,
    output_price: output,
    cache_write_price: 0,
    cache_read_price: cacheRead,
    image_input_price: 0,
    image_output_price: 0,
  }
}

describe('scheduled database price overrides', () => {
  const peakTime = Date.parse('2026-08-24T01:00:00Z')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not let official seed rows mask the dynamic schedule', async () => {
    mocks.query.mockResolvedValue({
      rows: [
        priceRow('deepseek-v4-flash', 0.14, 0.28, 0.0028),
        priceRow('deepseek-v4-pro', 0.435, 0.87, 0.003625),
        priceRow('deepseek-reasoner', 0.42, 0.84, 0.0035),
      ],
    })
    await loadPricing()

    expect(resolvePrice('deepseek', 'deepseek-v4-flash', peakTime)).toMatchObject({
      input: 0.44,
      output: 1.32,
    })
    expect(resolvePrice('deepseek', 'deepseek-v4-pro', peakTime)).toMatchObject({
      input: 1.32,
      output: 3.96,
    })
    expect(resolvePrice('deepseek', 'deepseek-reasoner', peakTime)).toMatchObject({
      input: 0.44,
      output: 1.32,
    })
  })

  it('keeps administrator-edited rows as fixed overrides', async () => {
    mocks.query.mockResolvedValue({
      rows: [priceRow('deepseek-v4-pro', 2, 4, 0.2)],
    })
    await loadPricing()

    expect(resolvePrice('deepseek', 'deepseek-v4-pro', peakTime)).toMatchObject({
      input: 2,
      output: 4,
      cacheRead: 0.2,
    })
  })

  it('does not let a broad Codex row mask the dedicated Spark price', async () => {
    mocks.query.mockResolvedValue({
      rows: [priceRow('gpt-5.3-codex', 1.5, 12, 0.15, 'openai')],
    })
    await loadPricing()

    expect(resolvePrice('openai', 'gpt-5.3-codex-spark')).toMatchObject({
      input: 1.75,
      output: 14,
      cacheRead: 0.175,
    })
  })

  it('does not let seeded Gemini rows freeze the promotional price', async () => {
    mocks.query.mockResolvedValue({
      rows: [
        priceRow('gemini-3.8-flash', 0.75, 3.75, 0.075, 'gemini'),
        priceRow('flash', 1.5, 7.5, 0.15, 'gemini'),
      ],
    })
    await loadPricing()

    expect(resolvePrice('gemini', 'gemini-3.8-flash', Date.parse('2026-12-31T23:59:59.999Z')))
      .toMatchObject({ input: 0.75, output: 3.75, cacheRead: 0.075 })
    expect(resolvePrice('gemini', 'gemini-3.8-flash', Date.parse('2027-01-01T00:00:00Z')))
      .toMatchObject({ input: 1.5, output: 7.5, cacheRead: 0.15 })
  })

  it('keeps administrator-edited Gemini prices as fixed overrides', async () => {
    mocks.query.mockResolvedValue({
      rows: [priceRow('gemini-3.8-flash', 2, 8, 0.2, 'gemini')],
    })
    await loadPricing()

    expect(resolvePrice('gemini', 'gemini-3.8-flash', Date.parse('2026-09-03T00:00:00Z')))
      .toMatchObject({ input: 2, output: 8, cacheRead: 0.2 })
  })
})
