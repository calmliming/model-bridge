import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'

const config = vi.hoisted(() => ({ SECURITY_HEADERS_ENABLED: true, ALIPAY_ENV: 'production', GOOGLE_LOGIN_CLIENT_ID: '' }))
vi.mock('../config', () => ({ config }))
vi.mock('../auth/security', () => ({ turnstileEnabled: () => false }))
import { registerSecurityHeaders } from './securityHeaders'

afterEach(() => { config.ALIPAY_ENV = 'production' })

describe('Alipay web checkout browser policy', () => {
  it.each([
    ['production', 'https://*.alipay.com'],
    ['sandbox', 'https://*.alipaydev.com'],
  ])('allows the %s gateway and cashier form navigation', async (environment, allowed) => {
    config.ALIPAY_ENV = environment
    const app = Fastify()
    registerSecurityHeaders(app)
    app.get('/app', () => 'checkout')
    try {
      const response = await app.inject('/app')
      const policy = String(response.headers['content-security-policy']).split('; ')
      expect(policy.find(part => part.startsWith('form-action '))).toBe(`form-action 'self' ${allowed}`)
      expect(policy).toContain("script-src 'self'")
      expect(policy).toContain("frame-ancestors 'none'")
    } finally { await app.close() }
  })
})
