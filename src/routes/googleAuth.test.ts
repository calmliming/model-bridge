import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  config: { GOOGLE_LOGIN_CLIENT_ID: 'test.apps.googleusercontent.com', SECURITY_HEADERS_ENABLED: true },
  verifyGoogleCredential: vi.fn(), signInGoogleUser: vi.fn(), isRegistrationEnabled: vi.fn(),
  checkLoginRateLimit: vi.fn(), checkRateLimit: vi.fn(),
}))
vi.mock('../config', () => ({ config: mocks.config }))
vi.mock('../store/redis', () => ({ getRedis: () => null }))
vi.mock('../auth/google', async original => ({ ...await original<typeof import('../auth/google')>(), verifyGoogleCredential: mocks.verifyGoogleCredential }))
vi.mock('../users/google', async original => ({ ...await original<typeof import('../users/google')>(), signInGoogleUser: mocks.signInGoogleUser }))
vi.mock('../db/index', () => ({ pool: {}, db: {} }))
vi.mock('../db/settings', () => ({ isRegistrationEnabled: mocks.isRegistrationEnabled }))
vi.mock('../auth/security', () => ({ checkLoginRateLimit: mocks.checkLoginRateLimit, turnstileEnabled: () => false }))
vi.mock('../middleware/limits', () => ({ checkRateLimit: mocks.checkRateLimit }))

import { registerGoogleAuthRoutes } from './googleAuth'
import { registerSecurityHeaders } from '../middleware/securityHeaders'
import { GoogleAuthError, verifyGoogleCredential } from '../auth/google'
import { GoogleLinkRequiredError } from '../users/google'

const user = { id: 'user-1', email: 'test@example.com', name: 'Test', status: 'active' }
const identity = { sub: 'google-1', email: user.email, name: user.name }
let app: ReturnType<typeof Fastify>
beforeEach(async () => {
  vi.clearAllMocks()
  mocks.config.GOOGLE_LOGIN_CLIENT_ID = 'test.apps.googleusercontent.com'
  mocks.checkRateLimit.mockResolvedValue(true)
  mocks.checkLoginRateLimit.mockResolvedValue(true)
  mocks.isRegistrationEnabled.mockResolvedValue(true)
  mocks.verifyGoogleCredential.mockResolvedValue(identity)
  mocks.signInGoogleUser.mockImplementation(async ({ consumeProof }) => { await consumeProof(); return user })
  app = Fastify({ trustProxy: true })
  await app.register(fastifyJwt, { secret: 'google-login-test-secret' })
  registerSecurityHeaders(app)
  registerGoogleAuthRoutes(app)
})
afterEach(async () => { await app.close(); vi.useRealTimers() })

async function challenge(headers = {}) {
  const response = await app.inject({ method: 'POST', url: '/api/auth/google/challenge', payload: {}, headers })
  return { response, nonce: response.json().nonce, cookie: String(response.headers['set-cookie']).split(';')[0]! }
}
const login = (cookie = '', payload: Record<string, unknown> = { credential: 'id-token' }) => app.inject({
  method: 'POST', url: '/api/auth/google', payload, headers: { cookie },
})

describe('Google sign-in HTTP flow', () => {
  it('binds proof to an HttpOnly browser cookie and issues only a normal user session', async () => {
    const { response, cookie, nonce } = await challenge()
    expect(response.statusCode).toBe(200)
    expect(response.headers['set-cookie']).toContain('HttpOnly; SameSite=Strict; Max-Age=300')
    expect(response.headers['cache-control']).toBe('no-store')
    const result = await login(cookie)
    expect(result.statusCode).toBe(200)
    expect(verifyGoogleCredential).toHaveBeenCalledWith('id-token', nonce)
    expect(result.json()).toMatchObject({ role: 'user', user })
    expect(app.jwt.verify(result.json().token)).toMatchObject({ sub: user.id, role: 'user' })
    expect(result.headers['set-cookie']).toContain('Max-Age=0')
    expect((await login(cookie)).statusCode).toBe(401)
    expect(mocks.signInGoogleUser).toHaveBeenCalledTimes(1)
  })
  it('uses a secure host-only cookie behind HTTPS proxies', async () => {
    const { response } = await challenge({ 'x-forwarded-proto': 'https' })
    expect(response.headers['set-cookie']).toMatch(/^__Host-mb_google_nonce=/)
    expect(response.headers['set-cookie']).toContain('; Secure')
  })
  it('rejects absent, forged, duplicate and expired browser cookies before checking a token', async () => {
    const { cookie } = await challenge()
    expect((await login()).statusCode).toBe(401)
    expect((await login('mb_google_nonce=forged')).statusCode).toBe(401)
    expect((await login(`${cookie}; ${cookie}`)).statusCode).toBe(401)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 301_000)
    expect((await login(cookie)).statusCode).toBe(401)
    expect(mocks.verifyGoogleCredential).not.toHaveBeenCalled()
  })
  it('rejects invalid Google credentials without touching the user account', async () => {
    const { cookie } = await challenge()
    mocks.verifyGoogleCredential.mockRejectedValue(new GoogleAuthError())
    expect((await login(cookie)).statusCode).toBe(401)
    expect(mocks.signInGoogleUser).not.toHaveBeenCalled()
  })
  it('lets the same proof be retried with an explicit password after a linking prompt', async () => {
    const { cookie } = await challenge()
    mocks.signInGoogleUser.mockRejectedValueOnce(new GoogleLinkRequiredError())
    const first = await login(cookie)
    expect(first.statusCode).toBe(409)
    expect(first.json().code).toBe('google_link_required')
    expect(first.json().token).toBeUndefined()
    const result = await login(cookie, { credential: 'id-token', password: 'existing-password' })
    expect(result.statusCode).toBe(200)
    expect(mocks.signInGoogleUser).toHaveBeenLastCalledWith(expect.objectContaining({ password: 'existing-password' }))
  })
  it('enforces rate limits before upstream verification and password confirmation', async () => {
    mocks.checkRateLimit.mockResolvedValueOnce(false)
    expect((await challenge()).response.statusCode).toBe(429)
    const { cookie } = await challenge()
    mocks.checkLoginRateLimit.mockResolvedValue(false)
    expect((await login(cookie)).statusCode).toBe(429)
    expect(mocks.signInGoogleUser).not.toHaveBeenCalled()
  })
  it('passes the live registration setting through to account checks', async () => {
    const { cookie } = await challenge()
    mocks.isRegistrationEnabled.mockResolvedValue(false)
    await login(cookie)
    expect(mocks.signInGoogleUser).toHaveBeenCalledWith(expect.objectContaining({ registrationEnabled: false }))
  })
  it('rejects cross-site forms and cross-site JavaScript requests', async () => {
    const form = await app.inject({ method: 'POST', url: '/api/auth/google/challenge', payload: '{}', headers: { 'content-type': 'text/plain' } })
    expect(form.statusCode).toBe(403)
    expect((await challenge({ 'sec-fetch-site': 'cross-site' })).response.statusCode).toBe(403)
  })
  it('disables both endpoints without a configured client ID', async () => {
    mocks.config.GOOGLE_LOGIN_CLIENT_ID = ''
    expect((await challenge()).response.statusCode).toBe(403)
    expect((await login()).statusCode).toBe(403)
  })
  it('allows the Google SDK through CSP only when enabled and supports popup communication', async () => {
    const { response } = await challenge()
    const csp = response.headers['content-security-policy'] as string
    expect(csp).toContain('script-src \'self\' https://accounts.google.com/gsi/client')
    expect(csp).toContain('connect-src \'self\' https://accounts.google.com/gsi/')
    expect(csp).toContain('https://accounts.google.com/gsi/style')
    expect(response.headers['cross-origin-opener-policy']).toBe('same-origin-allow-popups')
    expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    mocks.config.GOOGLE_LOGIN_CLIENT_ID = ''
    const disabled = (await challenge()).response
    expect(disabled.headers['content-security-policy']).not.toContain('accounts.google.com')
    expect(disabled.headers['referrer-policy']).toBe('no-referrer')
  })
})
