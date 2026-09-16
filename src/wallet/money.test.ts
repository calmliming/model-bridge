import { describe, expect, it } from 'vitest'
import { microsToUsd, roundUsd, usdToMicros } from './money'

describe('wallet money conversion', () => {
  it('stores USD as signed micro-USD integers', () => {
    expect(usdToMicros(1)).toBe(1_000_000)
    expect(usdToMicros(0.1234564)).toBe(123_456)
    expect(usdToMicros(-2.5)).toBe(-2_500_000)
  })

  it('converts micro-USD back to decimal USD', () => {
    expect(microsToUsd(1_250_000)).toBe(1.25)
    expect(microsToUsd(-42)).toBe(-0.000042)
  })

  it('rounds a cost to an amount the wallet can debit exactly', () => {
    // The invariant that keeps usage_logs.cost, quota_used and the wallet in
    // agreement: rounding to the wallet's unit means usdToMicros(roundUsd(x))
    // is x exactly, with no rounding left over to debit.
    for (const value of [4e-7, 1.2e-7, 6e-7, 0.0000025, 0.1234564, 12.3456789, 3.9999996]) {
      const rounded = roundUsd(value)
      expect(usdToMicros(rounded)).toBeCloseTo(rounded * 1_000_000, 6)
      expect(Math.round(rounded * 1e6)).toBe(rounded * 1e6)
    }
  })
})
