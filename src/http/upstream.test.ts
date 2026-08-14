import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchWithConnectTimeout } from './upstream'

const originalHostAllowlist = process.env.UPSTREAM_HOST_ALLOWLIST

beforeEach(() => {
  process.env.UPSTREAM_HOST_ALLOWLIST = 'upstream.example'
})

afterEach(() => {
  if (originalHostAllowlist === undefined) delete process.env.UPSTREAM_HOST_ALLOWLIST
  else process.env.UPSTREAM_HOST_ALLOWLIST = originalHostAllowlist
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('fetchWithConnectTimeout', () => {
  it('passes an abort signal and clears the deadline after headers arrive', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (_input: string, init: RequestInit) => {
      signal = init.signal as AbortSignal
      return new Response('ok')
    }))

    await expect(fetchWithConnectTimeout('https://upstream.example', {}, 1000)).resolves.toBeInstanceOf(Response)
    await vi.advanceTimersByTimeAsync(2000)
    expect(signal?.aborted).toBe(false)
  })

  it('aborts a request that never returns response headers', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_input: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    vi.stubGlobal('fetch', fetchMock)

    const pending = fetchWithConnectTimeout('https://upstream.example', {}, 1000)
    const result = expect(pending).rejects.toThrow('aborted')
    await vi.advanceTimersByTimeAsync(1000)
    await result
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
