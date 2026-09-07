import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'

const mocks = vi.hoisted(() => ({
  config: {
    TURNSTILE_SITE_KEY: 'test-site', TURNSTILE_SECRET_KEY: 'test-secret',
    ENCRYPTION_KEY: '0'.repeat(64), STATS_TIMEZONE: 'Asia/Shanghai',
  },
  verifyUserCredentials: vi.fn(),
  user: { id: 'user-1', email: 'test@example.com', name: 'Test', status: 'active' },
}))
vi.mock('../config', () => ({ config: mocks.config }))
vi.mock('../db/index', () => ({ db: {}, pool: {} }))
vi.mock('../users/manager', async (original) => ({
  ...await original<typeof import('../users/manager')>(),
  verifyUserCredentials: mocks.verifyUserCredentials,
}))
vi.mock('../auth/admin', () => ({ verifyAdminCredentials: async () => false }))

import { registerUserRoutes } from './users'
import { registerAuthRoutes } from './auth'
import { resetLimits } from '../middleware/limits'

beforeEach(async () => {
  vi.clearAllMocks()
  await resetLimits()
  mocks.config.TURNSTILE_SITE_KEY = 'test-site'
  mocks.config.TURNSTILE_SECRET_KEY = 'test-secret'
  mocks.verifyUserCredentials.mockResolvedValue(mocks.user)
})
afterEach(() => vi.unstubAllGlobals())

async function withApp(run: (app: ReturnType<typeof Fastify>) => Promise<void>) {
  const app = Fastify()
  await app.register(fastifyJwt, { secret: 'user-login-test-secret' })
  registerUserRoutes(app)
  registerAuthRoutes(app)
  try { await run(app) } finally { await app.close() }
}

const credentials = { email: 'test@example.com', password: 'password' }

describe('legacy user login security', () => {
  it('rejects missing Turnstile tokens before checking credentials', () => withApp(async (app) => {
    const response = await app.inject({ method: 'POST', url: '/api/users/login', payload: credentials })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: '人机验证失败，请重试' })
    expect(mocks.verifyUserCredentials).not.toHaveBeenCalled()
  }))

  it('rejects a failed Turnstile verification', () => withApp(async (app) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false }))))
    const response = await app.inject({ method: 'POST', url: '/api/users/login',
      payload: { ...credentials, turnstileToken: 'invalid-token' } })
    expect(response.statusCode).toBe(400)
    expect(mocks.verifyUserCredentials).not.toHaveBeenCalled()
  }))

  it('accepts a verified token and preserves the legacy session response', () => withApp(async (app) => {
    const verify = vi.fn(async () => new Response(JSON.stringify({ success: true })))
    vi.stubGlobal('fetch', verify)
    const response = await app.inject({ method: 'POST', url: '/api/users/login',
      payload: { ...credentials, turnstileToken: 'verified-token' } })
    expect(response.statusCode).toBe(200)
    expect(response.json().user).toEqual(mocks.user)
    expect(app.jwt.verify(response.json().token)).toMatchObject({ sub: 'user-1', role: 'user' })
    const [, options] = verify.mock.calls[0] as unknown as [string, { body: URLSearchParams }]
    expect(options.body.get('response')).toBe('verified-token')
  }))

  it('allows login without a token when Turnstile is disabled', () => withApp(async (app) => {
    mocks.config.TURNSTILE_SECRET_KEY = ''
    const response = await app.inject({ method: 'POST', url: '/api/users/login', payload: credentials })
    expect(response.statusCode).toBe(200)
  }))

  it('shares the login attempt budget with the unified login endpoint', () => withApp(async (app) => {
    mocks.config.TURNSTILE_SECRET_KEY = ''
    mocks.verifyUserCredentials.mockResolvedValue(null)
    for (let i = 0; i < 10; i++) {
      const unified = i % 2 === 0
      const response = await app.inject({ method: 'POST',
        url: unified ? '/api/auth/login' : '/api/users/login',
        payload: unified ? { account: credentials.email.toUpperCase(), password: 'wrong' } : credentials })
      expect(response.statusCode).toBe(401)
    }
    const blocked = await app.inject({ method: 'POST', url: '/api/users/login', payload: credentials })
    expect(blocked.statusCode).toBe(429)
    expect(mocks.verifyUserCredentials).toHaveBeenCalledTimes(10)
  }))
})
