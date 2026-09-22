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
  it('keeps Image 2.5 pricing independent from old broad image rows', async () => {
    mocks.query.mockResolvedValue({ rows: [{ ...priceRow('gpt-image-2', 1, 2, 0.1, 'openai'), image_input_price: 1, image_output_price: 2 }] })
    await loadPricing()
    expect(resolvePrice('openai', 'gpt-image-2.5-flare')).toMatchObject({ input: 5, imageInput: 8, imageCacheRead: 2, imageOutput: 30 })
  })
  it('bills gemini-3.7-flash at the promo rate and switches over in 2027', async () => {
    // The seeded row holds the promo tuple, which isManagedScheduledDefault
    // recognises, so resolvePrice discards it and falls through to the built-in
    // tier. The assertions in pricing.test.ts run without a database and so
    // cover only that built-in tier — this is the path that proves the row is
    // seeded and skipped rather than honoured.
    mocks.query.mockResolvedValue({ rows: [priceRow('gemini-3.7-flash', 0.75, 3.75, 0.075, 'gemini')] })
    await loadPricing()
    expect(resolvePrice('gemini', 'gemini-3.7-flash', Date.parse('2026-09-14T14:00:00+08:00')))
      .toMatchObject({ input: 0.75, output: 3.75, cacheRead: 0.075 })
    expect(resolvePrice('gemini', 'gemini-3.7-flash', Date.parse('2027-06-01T00:00:00+08:00')))
      .toMatchObject({ input: 1.5, output: 7.5, cacheRead: 0.15 })
  })

  it('updates seeded Flash and Pro prices without freezing new Flash at its seed rate', async () => {
    mocks.query.mockResolvedValue({ rows: [
      priceRow('deepseek-flash', 0.15, 0.6, 0.003),
      priceRow('deepseek-v4-flash', 0.14, 0.28, 0.0028),
      priceRow('deepseek-v4-pro', 0.435, 0.87, 0.003625),
    ] })
    await loadPricing()
    for (const model of ['deepseek-flash', 'deepseek-v4-flash']) {
      expect(resolvePrice('deepseek', model, Date.parse('2026-09-14T14:00:00+08:00')))
        .toMatchObject({ input: 0.3, output: 1.2, cacheRead: 0.006 })
    }
    expect(resolvePrice('deepseek', 'deepseek-v4-pro', Date.parse('2026-09-14T11:59:59+08:00')))
      .toMatchObject({ input: 1.32, output: 3.96 })
    expect(resolvePrice('deepseek', 'deepseek-v4-pro', Date.parse('2026-09-16T14:00:00+08:00')))
      .toMatchObject({ input: 1.32, output: 3.96, cacheRead: 0.044 })
    expect(resolvePrice('deepseek', 'deepseek-v4-pro', Date.parse('2026-09-16T12:30:00+08:00')))
      .toMatchObject({ input: 0.66, output: 1.98, cacheRead: 0.022 })
  })

  it('preserves custom prices through the Flash launch and canceled Pro retirement', async () => {
    mocks.query.mockResolvedValue({ rows: [
      priceRow('deepseek-flash', 0.5, 2, 0.05),
      priceRow('deepseek-v4-pro', 2, 4, 0.2),
    ] })
    await loadPricing()
    expect(resolvePrice('deepseek', 'deepseek-flash', Date.parse('2026-09-10T14:00:00+08:00')))
      .toMatchObject({ input: 0.5, output: 2, cacheRead: 0.05 })
    expect(resolvePrice('deepseek', 'deepseek-v4-pro', Date.parse('2026-09-14T14:00:00+08:00')))
      .toMatchObject({ input: 2, output: 4, cacheRead: 0.2 })
  })
  it('does not bill Astra at the generic GPT fallback on an existing database', async () => {
    mocks.query.mockResolvedValue({ rows: [priceRow('gpt', 1.25, 10, 0.125, 'openai')] })
    await loadPricing()
    expect(resolvePrice('openai', 'gpt-6-astra')).toMatchObject({ input: 10, output: 50, cacheWrite: 12.5 })
  })
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

  it('does not let the Opus 5.5 row capture the shorter Opus 5 name', async () => {
    // Regression: resolvePrice's substring pass matches bidirectionally
    // (dbModel.includes(model)) and prefers the longest key, so a seeded
    // "claude-opus-5-5" row also matches a plain "claude-opus-5" request and
    // silently under-bills it 5 → 4. The fix is an exact `claude-opus-5` seed
    // row, which wins in the exact-match pass before the substring pass runs.
    // This row set is what a freshly seeded database actually contains.
    mocks.query.mockResolvedValue({
      rows: [
        priceRow('opus', 5, 25, 0.5, 'claude'),
        priceRow('claude-opus-5', 5, 25, 0.5, 'claude'),
        priceRow('claude-opus-5-5', 4, 20, 0.2, 'claude'),
      ],
    })
    await loadPricing()

    expect(resolvePrice('claude', 'claude-opus-5')).toMatchObject({
      input: 5,
      output: 25,
      cacheRead: 0.5,
    })
    expect(resolvePrice('claude', 'claude-opus-5-5')).toMatchObject({
      input: 4,
      output: 20,
      cacheRead: 0.2,
    })
    // A sibling we did not seed keeps resolving through the generic "opus" row.
    expect(resolvePrice('claude', 'claude-opus-4-8')).toMatchObject({ input: 5, output: 25 })
  })
})
