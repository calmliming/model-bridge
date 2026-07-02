import { describe, expect, it } from 'vitest'
import { scoreFromStats } from './health'

describe('scoreFromStats', () => {
  it('returns null when there is no traffic', () => {
    expect(scoreFromStats(0, 0, null)).toBeNull()
  })

  it('is 100 for all-success, fast responses', () => {
    expect(scoreFromStats(50, 50, 1200)).toBe(100)
  })

  it('drops proportionally with the error rate', () => {
    expect(scoreFromStats(10, 8, 1000)).toBe(80) // 20% errors → 80
    expect(scoreFromStats(4, 2, 500)).toBe(50) // 50% errors → 50
  })

  it('docks slow-but-successful accounts by the latency penalty', () => {
    // avg latency at/above LAT_BAD (20s) → full 20-point penalty
    expect(scoreFromStats(20, 20, 20_000)).toBe(80)
    expect(scoreFromStats(20, 20, 30_000)).toBe(80)
  })

  it('applies a partial latency penalty in the ramp band', () => {
    // halfway between 3s and 20s → ~10-point penalty
    expect(scoreFromStats(10, 10, 11_500)).toBe(90)
  })

  it('never returns below 0', () => {
    expect(scoreFromStats(10, 0, 30_000)).toBe(0)
  })
})
