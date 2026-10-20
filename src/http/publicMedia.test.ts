import { createServer } from 'node:http'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }))

import { assertSafePublicMediaEgress, UnsafeUpstreamUrlError } from './urlGuard'
import { closeUpstreamDispatcher, fetchPublicMedia, fetchWithConnectTimeout } from './upstream'
import { relayGrsaiImages } from '../providers/grsai/images'

beforeEach(() => {
  mocks.lookup.mockReset().mockResolvedValue([{ address: '8.8.8.8', family: 4 }])
  vi.stubEnv('UPSTREAM_URL_GUARD_ENABLED', 'true')
  vi.stubEnv('UPSTREAM_HOST_ALLOWLIST', '')
  vi.stubEnv('UPSTREAM_PORT_ALLOWLIST', '80,443')
  for (const name of ['UPSTREAM_PROXY_URL', 'HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy']) vi.stubEnv(name, '')
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
afterAll(closeUpstreamDispatcher)

describe('public media egress', () => {
  it.each(['http://127.0.0.1/a.png', 'http://10.0.0.1/a.png', 'http://169.254.169.254/a.png',
    'http://100.64.0.1/a.png', 'http://[::1]/a.png', 'http://[::ffff:127.0.0.1]/a.png',
    'http://[fd00::1]/a.png', 'file:///tmp/a.png', 'https://user:secret@cdn.example/a.png'])(
    'rejects %s even with upstream exemptions enabled', async url => {
      vi.stubEnv('UPSTREAM_URL_GUARD_ENABLED', 'false')
      vi.stubEnv('UPSTREAM_HOST_ALLOWLIST', new URL(url).hostname)
      const fetch = vi.fn()
      vi.stubGlobal('fetch', fetch)
      await expect(fetchPublicMedia(url)).rejects.toThrow(UnsafeUpstreamUrlError)
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it.each(['cdn.example', 'api.anthropic.com'])(
    'checks every DNS answer even for exempt upstream host %s', async host => {
      vi.stubEnv('UPSTREAM_HOST_ALLOWLIST', host)
      vi.stubEnv('UPSTREAM_URL_GUARD_ENABLED', 'false')
      mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }, { address: '192.168.1.1', family: 4 }])
      await expect(assertSafePublicMediaEgress(`https://${host}/a.png`)).rejects.toThrow(/non-public/)
    },
  )

  it('fails closed on DNS resolution failure or an empty answer', async () => {
    mocks.lookup.mockRejectedValueOnce(new Error('NXDOMAIN'))
    await expect(assertSafePublicMediaEgress('https://cdn.example/a.png')).rejects.toThrow(/unable to resolve/)
    mocks.lookup.mockResolvedValueOnce([])
    await expect(assertSafePublicMediaEgress('https://cdn.example/a.png')).rejects.toThrow(/non-public/)
  })

  it('uses the guarded connector for public downloads, preserving cancellation and rejecting redirects', async () => {
    vi.stubEnv('UPSTREAM_HOST_ALLOWLIST', '8.8.8.8')
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response('image'))
    vi.stubGlobal('fetch', fetch)
    await fetchWithConnectTimeout('https://8.8.8.8/a.png')
    expect(fetch.mock.calls[0]?.[1]).not.toHaveProperty('dispatcher')
    const caller = new AbortController()
    await fetchPublicMedia('https://8.8.8.8/a.png', caller.signal)
    const init = fetch.mock.calls[1]?.[1] as RequestInit & { dispatcher: unknown }
    expect(init.dispatcher).toBeDefined()
    expect(init.redirect).toBe('error')
    expect(init.headers).toBeUndefined()
    caller.abort()
    expect(init.signal?.aborted).toBe(true)
  })

  it('retains a configured environment proxy after validating the public destination', async () => {
    vi.stubEnv('UPSTREAM_PROXY_URL', 'http://127.0.0.1:7890')
    vi.stubEnv('UPSTREAM_HOST_ALLOWLIST', 'cdn.example')
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response('image'))
    vi.stubGlobal('fetch', fetch)
    await fetchPublicMedia('https://cdn.example/a.png')
    expect(mocks.lookup).toHaveBeenCalledWith('cdn.example', { all: true, verbatim: true })
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ dispatcher: expect.anything(), redirect: 'error' })
    mocks.lookup.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
    await expect(fetchPublicMedia('https://cdn.example/a.png')).rejects.toThrow(/non-public/)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('blocks DNS rebinding at the actual socket even for an allowed upstream host', async () => {
    let hits = 0
    const server = createServer((_req, res) => { hits++; res.end('private') })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address() as { port: number }
      vi.stubEnv('UPSTREAM_PORT_ALLOWLIST', String(address.port))
      vi.stubEnv('UPSTREAM_HOST_ALLOWLIST', 'rebinding.example')
      vi.stubEnv('UPSTREAM_URL_GUARD_ENABLED', 'false')
      let resolutions = 0
      mocks.lookup.mockImplementation(async () => [{ address: ++resolutions === 1 ? '8.8.8.8' : '127.0.0.1', family: 4 }])
      await expect(fetchPublicMedia(`http://rebinding.example:${address.port}/a.png`)).rejects.toThrow()
      expect(resolutions).toBeGreaterThanOrEqual(2)
      expect(hits).toBe(0)
    } finally {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('allows a private GrsAI gateway while blocking its returned private image URL', async () => {
    let generated = 0, downloaded = 0, origin = ''
    const server = createServer((req, res) => {
      if (req.url === '/v1/api/generate') {
        generated++
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ id: 'private-gateway-test', status: 'succeeded', results: [{ url: `${origin}/private.png` }] }))
      } else {
        downloaded++
        res.setHeader('content-type', 'image/png')
        res.end('private bytes')
      }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address() as { port: number }
      origin = `http://127.0.0.1:${address.port}`
      vi.stubEnv('UPSTREAM_HOST_ALLOWLIST', '127.0.0.1')
      vi.stubEnv('UPSTREAM_PORT_ALLOWLIST', String(address.port))
      const result = await relayGrsaiImages('supplier-secret', { model: 'gpt-image-2.5-flare', prompt: 'cat',
        stream: false, n: 1, response_format: 'b64_json', images: [], __image_endpoint: 'generations' }, origin)
      expect(result.status).toBe(502)
      expect(await result.text()).not.toContain('private bytes')
      expect(generated).toBe(1)
      expect(downloaded).toBe(0)
    } finally {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
})
