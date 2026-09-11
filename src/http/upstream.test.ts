import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchWithConnectTimeout } from './upstream'
import { cancelUpstreamResponse, withUpstreamSignal } from './cancellation'

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
  it('preserves caller and request abort signals after headers arrive', async () => {
    let signal!: AbortSignal
    vi.stubGlobal('fetch', vi.fn(async (_input: string, init: RequestInit) => {
      signal = init.signal as AbortSignal
      return new Response('ok')
    }))
    const client = new AbortController()
    const caller = new AbortController()
    await withUpstreamSignal(client.signal, () => fetchWithConnectTimeout('https://upstream.example', { signal: caller.signal }))
    client.abort()
    expect(signal.aborted).toBe(true)
    await fetchWithConnectTimeout('https://upstream.example', { signal: caller.signal })
    expect(signal.aborted).toBe(false)
    caller.abort()
    expect(signal.aborted).toBe(true)
  })

  it('does not send an already canceled request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(fetchWithConnectTimeout('https://upstream.example', { signal: AbortSignal.abort() })).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('aborts transport before canceling an unread cloned response', async () => {
    let signal!: AbortSignal
    vi.stubGlobal('fetch', vi.fn(async (_input: string, init: RequestInit) => {
      signal = init.signal as AbortSignal
      return new Response(new ReadableStream({ start(controller) {
        signal.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true })
      } }))
    }))
    const response = await fetchWithConnectTimeout('https://upstream.example')
    const clone = response.clone()
    await cancelUpstreamResponse(response)
    expect(signal.aborted).toBe(true)
    await expect(clone.text()).rejects.toThrow('aborted')
  })
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
