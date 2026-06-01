import { describe, expect, it } from 'vitest'
import { microsToUsd, usdToMicros } from './money'

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
})
