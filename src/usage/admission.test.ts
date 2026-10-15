import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('../db', () => ({ pool: {
  query: mocks.query,
  connect: async () => ({ query: mocks.query, release() {} }),
} }))

import { admitRelayRequest } from './admission'

const input = { apiKeyId: 'key', userId: 'user', keyLimit: 1, userLimit: 1,
  estimateMicros: 10, billTo: 'balance' as const, enforceBalance: true }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_700_000_000_000)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith('WITH active AS')) return { rows: [{ key_count: 0, user_count: 0, account_count: 0,
      key_reserved: 0, reserved: 0, key_media_count: 0, balance_media_count: 0 }], rowCount: 1 }
    if (sql.startsWith('SELECT balance_micros')) return { rows: [{ balance_micros: 100 }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  })
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('relay reservation lease', () => {
  it('renews a long-running relay and stops every timer when released', async () => {
    const admission = await admitRelayRequest(input)
    await vi.advanceTimersByTimeAsync(180_000)
    expect(admission.signal.aborted).toBe(false)
    const renewals = mocks.query.mock.calls.filter(([sql]) => sql.startsWith('UPDATE relay_reservations SET lease_expires_at'))
    expect(renewals).toHaveLength(6)
    expect(renewals.at(-1)![1][1]).toBe(Date.now() + 90_000)
    await admission.release()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts a hanging renewal before its lease expires and still releases without waiting for the query', async () => {
    const admission = await admitRelayRequest(input)
    let resolveQuery!: (result: { rowCount: number }) => void
    const pending = new Promise<{ rowCount: number }>(resolve => { resolveQuery = resolve })
    mocks.query.mockImplementation((sql: string) => sql.startsWith('UPDATE relay_reservations SET lease_expires_at')
      ? pending : Promise.resolve({ rows: [], rowCount: 1 }))
    await vi.advanceTimersByTimeAsync(39_999)
    expect(admission.signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(admission.signal.aborted).toBe(true)
    expect(admission.signal.reason.message).toContain('timed out')
    // A late SQL result cannot restore this canceled request or restart renewal.
    resolveQuery({ rowCount: 1 })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.query.mock.calls.filter(([sql]) => sql.startsWith('UPDATE relay_reservations SET lease_expires_at'))).toHaveLength(1)
    await admission.release()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts when the reservation was lost instead of continuing without capacity', async () => {
    const admission = await admitRelayRequest(input)
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(admission.signal.aborted).toBe(true)
    await admission.release()
  })

  it('uses the last confirmed expiry when a delayed transaction consumed the initial lease', async () => {
    const original = mocks.query.getMockImplementation()!
    mocks.query.mockImplementation(async (sql: string, values: unknown[]) => {
      if (sql === 'COMMIT') vi.setSystemTime(Date.now() + 95_000)
      return original(sql, values)
    })
    const admission = await admitRelayRequest(input)
    await vi.advanceTimersByTimeAsync(0)
    expect(admission.signal.aborted).toBe(true)
    await admission.release()
  })
})
