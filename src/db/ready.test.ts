import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitForDatabase } from './ready'

afterEach(() => vi.restoreAllMocks())

describe('database startup readiness', () => {
  it('retries transient connection failures and recovers', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const query = vi.fn().mockRejectedValueOnce({ code: 'ECONNREFUSED' })
      .mockRejectedValueOnce({ code: '57P03' }).mockResolvedValue({ rows: [] })
    await waitForDatabase({ query }, { delayMs: 0 })
    expect(query).toHaveBeenCalledTimes(3)
    expect(query).toHaveBeenLastCalledWith('SELECT 1')
  })
  it('stops after the configured number of attempts', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const query = vi.fn().mockRejectedValue({ code: 'ECONNRESET' })
    await expect(waitForDatabase({ query }, { attempts: 3, delayMs: 0 })).rejects.toMatchObject({ code: 'ECONNRESET' })
    expect(query).toHaveBeenCalledTimes(3)
  })
  it.each(['28P01', '42501', '42601'])('does not retry permanent error %s', async (code) => {
    const query = vi.fn().mockRejectedValue({ code })
    await expect(waitForDatabase({ query }, { delayMs: 0 })).rejects.toMatchObject({ code })
    expect(query).toHaveBeenCalledTimes(1)
  })
})
