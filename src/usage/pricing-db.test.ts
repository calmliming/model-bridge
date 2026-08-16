import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}))

vi.mock('../db/index', () => ({
  pool: { query: mocks.query },
}))

import { loadPricing, resolvePrice } from './pricing'

function priceRow(model: string, input: number, output: number, cacheRead: number) {
  return {
    provider: 'deepseek',
    model,
    input_price: input,
    output_price: output,
    cache_write_price: 0,
    cache_read_price: cacheRead,
    image_input_price: 0,
    image_output_price: 0,
  }
}

describe('DeepSeek database price overrides', () => {
  const peakTime = Date.parse('2026-08-17T01:00:00Z')

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
})
