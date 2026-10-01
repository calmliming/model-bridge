import { beforeEach, describe, expect, it } from 'vitest'
import { estimateReservationMicros, reserveInflightBalance, resetInflightReservations } from './inflight'

describe('reserveInflightBalance (memory backend)', () => {
  beforeEach(() => resetInflightReservations())

  it('always admits the first in-flight request, then requires remaining balance', async () => {
    const first = await reserveInflightBalance('user-1', 1_000, 5_000, 0)
    expect(first).not.toBeNull()
    // 1,000 balance − 5,000 reserved leaves nothing for a 100 estimate.
    expect(await reserveInflightBalance('user-1', 1_000, 100, 0)).toBeNull()
    await first!()
    expect(await reserveInflightBalance('user-1', 1_000, 100, 0)).not.toBeNull()
  })

  it('admits concurrent requests while the balance covers every reservation', async () => {
    const a = await reserveInflightBalance('user-1', 1_000, 400, 0)
    const b = await reserveInflightBalance('user-1', 1_000, 600, 0)
    expect(a && b).toBeTruthy()
    expect(await reserveInflightBalance('user-1', 1_000, 1, 0)).toBeNull()
    await b!()
    expect(await reserveInflightBalance('user-1', 1_000, 600, 0)).not.toBeNull()
  })

  it('keeps users independent and frees reservations after the TTL', async () => {
    await reserveInflightBalance('user-1', 100, 1_000, 0, 1_000)
    expect(await reserveInflightBalance('user-2', 100, 1_000, 0, 1_000)).not.toBeNull()
    expect(await reserveInflightBalance('user-1', 100, 50, 999, 1_000)).toBeNull()
    expect(await reserveInflightBalance('user-1', 100, 50, 1_000, 1_000)).not.toBeNull()
  })

  it('treats a non-positive estimate as no reservation', async () => {
    const release = await reserveInflightBalance('user-1', 0, 0, 0)
    expect(release).not.toBeNull()
    expect(await reserveInflightBalance('user-1', 1, 10, 0)).not.toBeNull()
  })
})

describe('estimateReservationMicros', () => {
  const base = { provider: 'claude', model: 'claude-sonnet-5', bodyBytes: 4_000, multiplier: 1, defaultOutputTokens: 8192 }

  it('prices body bytes / 4 input plus the declared output cap', () => {
    // Sonnet 5: $2 input, $10 output per 1M → (1000×2 + 500×10) / 1e6 = $0.007
    expect(estimateReservationMicros({ ...base, body: { max_tokens: 500 } })).toBe(7_000)
  })

  it('reads every protocol output cap and falls back to the default', () => {
    for (const body of [{ max_completion_tokens: 500 }, { max_output_tokens: 500 }, { generationConfig: { maxOutputTokens: 500 } }]) {
      expect(estimateReservationMicros({ ...base, body })).toBe(7_000)
    }
    // (1000×2 + 8192×10) / 1e6 = $0.08392
    expect(estimateReservationMicros({ ...base, body: {} })).toBe(83_920)
  })

  it('applies the group multiplier and caps runaway sizes', () => {
    expect(estimateReservationMicros({ ...base, body: { max_tokens: 500 }, multiplier: 2 })).toBe(14_000)
    // 200K input cap and 128K output cap: (200000×2 + 128000×10) / 1e6 = $1.68
    expect(estimateReservationMicros({ ...base, body: { max_tokens: 10_000_000 }, bodyBytes: 10_000_000 })).toBe(1_680_000)
  })

  it('returns null for an unpriced model so the caller fails open', () => {
    expect(estimateReservationMicros({ ...base, provider: 'unknown-provider', model: 'x', body: {} })).toBeNull()
  })
})
