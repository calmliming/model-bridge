import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { TRUSTED_LOCAL_PROXIES } from './trustProxy'

describe('zero-config trusted proxy integration', () => {
  it('uses X-Forwarded-For from a local or private direct peer', async () => {
    const trusted = Fastify({ trustProxy: TRUSTED_LOCAL_PROXIES })
    trusted.get('/', async (request) => ({ ip: request.ip }))

    const trustedResponse = await trusted.inject({
      method: 'GET',
      url: '/',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.10' },
    })
    expect(trustedResponse.json()).toEqual({ ip: '203.0.113.10' })
    await trusted.close()
  })

  it('ignores X-Forwarded-For from a public direct peer', async () => {
    const untrusted = Fastify({ trustProxy: TRUSTED_LOCAL_PROXIES })
    untrusted.get('/', async (request) => ({ ip: request.ip }))

    const untrustedResponse = await untrusted.inject({
      method: 'GET',
      url: '/',
      remoteAddress: '8.8.8.8',
      headers: { 'x-forwarded-for': '198.51.100.20' },
    })
    expect(untrustedResponse.json()).toEqual({ ip: '8.8.8.8' })
    await untrusted.close()
  })
})
