import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'

const mocks = vi.hoisted(() => ({
  config: {
    TURNSTILE_SITE_KEY: 'test-site', TURNSTILE_SECRET_KEY: 'test-secret',
    ENCRYPTION_KEY: '0'.repeat(64), STATS_TIMEZONE: 'Asia/Shanghai',
  },
  verifyUserCredentials: vi.fn(),
  getUserById: vi.fn(),
  userUsageDaily: vi.fn(),
  userFailureCategoriesToday: vi.fn(),
  user: { id: 'user-1', email: 'test@example.com', name: 'Test', status: 'active' },
}))
vi.mock('../config', () => ({ config: mocks.config }))
vi.mock('../db/index', () => ({ db: {}, pool: {} }))
vi.mock('../users/manager', async (original) => ({
  ...await original<typeof import('../users/manager')>(),
  verifyUserCredentials: mocks.verifyUserCredentials,
  getUserById: mocks.getUserById,
  userUsageDaily: mocks.userUsageDaily,
  userFailureCategoriesToday: mocks.userFailureCategoriesToday,
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
  mocks.getUserById.mockResolvedValue(mocks.user)
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

describe('user daily usage', () => {
  it('requires a user session and only accepts supported day ranges', () => withApp(async (app) => {
    mocks.userUsageDaily.mockResolvedValue([{ day: '2026-09-23', requests: 2, errors: 1, cost: 0.5 }])
    mocks.userFailureCategoriesToday.mockResolvedValue([{ category: '上游限流', count: 1 }])
    const token = app.jwt.sign({ sub: 'user-1', role: 'user' })
    const unauthorized = await app.inject({ method: 'GET', url: '/api/users/usage/daily' })
    expect(unauthorized.statusCode).toBe(401)

    const invalid = await app.inject({ method: 'GET', url: '/api/users/usage/daily?days=8', headers: { authorization: `Bearer ${token}` } })
    expect(invalid.statusCode).toBe(400)

    const valid = await app.inject({ method: 'GET', url: '/api/users/usage/daily?days=30', headers: { authorization: `Bearer ${token}` } })
    expect(valid.statusCode).toBe(200)
    expect(valid.json().daily[0].errors).toBe(1)
    expect(valid.json().failureCategories[0].category).toBe('上游限流')
    expect(mocks.userUsageDaily).toHaveBeenCalledTimes(1)
    expect(mocks.userUsageDaily).toHaveBeenCalledWith('user-1', 30)
    expect(mocks.userFailureCategoriesToday).toHaveBeenCalledWith('user-1')
  }))
})

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
