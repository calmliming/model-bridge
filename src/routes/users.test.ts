import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'

const mocks = vi.hoisted(() => ({
  config: {
    TURNSTILE_SITE_KEY: 'test-site', TURNSTILE_SECRET_KEY: 'test-secret',
    ENCRYPTION_KEY: '0'.repeat(64), STATS_TIMEZONE: 'Asia/Shanghai',
    API_KEY_MAX_ACTIVE_PER_USER: 200, API_KEY_MAX_CREATES_PER_HOUR: 60,
  },
  apiKeyCreationLimitError: vi.fn(),
  createApiKey: vi.fn(),
  verifyUserCredentials: vi.fn(),
  getUserById: vi.fn(),
  isOnlinePaymentEnabled: vi.fn(),
  getAvailableProviders: vi.fn(),
  userUsageDaily: vi.fn(),
  userFailureCategoriesToday: vi.fn(),
  user: { id: 'user-1', email: 'test@example.com', name: 'Test', status: 'active' },
}))
vi.mock('../config', () => ({ config: mocks.config }))
vi.mock('../db/index', () => ({ db: {}, pool: {} }))
vi.mock('../db/settings', async (original) => ({
  ...await original<typeof import('../db/settings')>(),
  isOnlinePaymentEnabled: mocks.isOnlinePaymentEnabled,
}))
vi.mock('../payments/providers/index', async (original) => ({
  ...await original<typeof import('../payments/providers/index')>(),
  getAvailableProviders: mocks.getAvailableProviders,
}))
vi.mock('../users/manager', async (original) => ({
  ...await original<typeof import('../users/manager')>(),
  verifyUserCredentials: mocks.verifyUserCredentials,
  getUserById: mocks.getUserById,
  userUsageDaily: mocks.userUsageDaily,
  userFailureCategoriesToday: mocks.userFailureCategoriesToday,
}))
vi.mock('../auth/admin', () => ({ verifyAdminCredentials: async () => false }))
vi.mock('../keys/manager', async (original) => ({
  ...await original<typeof import('../keys/manager')>(),
  apiKeyCreationLimitError: mocks.apiKeyCreationLimitError,
  createApiKey: mocks.createApiKey,
}))

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
  mocks.isOnlinePaymentEnabled.mockResolvedValue(true)
  mocks.getAvailableProviders.mockReturnValue(['manual', 'alipay', 'alipay_web', 'wechat'])
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

describe('online payment availability', () => {
  it('lists configured online channels when payments are enabled', () => withApp(async app => {
    const token = app.jwt.sign({ sub: 'user-1', role: 'user' })
    const response = await app.inject({ method: 'GET', url: '/api/users/payment-providers', headers: { authorization: `Bearer ${token}` } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ onlinePaymentsEnabled: true, providers: ['manual', 'alipay', 'alipay_web', 'wechat'] })
  }))

  it('hides online channels and rejects stale or direct checkout requests after disabling', () => withApp(async app => {
    mocks.isOnlinePaymentEnabled.mockResolvedValue(false)
    const token = app.jwt.sign({ sub: 'user-1', role: 'user' })
    const headers = { authorization: `Bearer ${token}` }
    const listing = await app.inject({ method: 'GET', url: '/api/users/payment-providers', headers })
    expect(listing.statusCode).toBe(200)
    expect(listing.json()).toEqual({ onlinePaymentsEnabled: false, providers: ['manual'] })
    const checkout = await app.inject({ method: 'POST', url: '/api/users/payment-orders', headers, payload: { amount: 1, provider: 'alipay' } })
    expect(checkout.statusCode).toBe(403)
    expect(checkout.json().error).toContain('在线支付已关闭')
  }))

  it('keeps payment availability behind user authentication', () => withApp(async app => {
    const response = await app.inject({ method: 'GET', url: '/api/users/payment-providers' })
    expect(response.statusCode).toBe(401)
    expect(mocks.isOnlinePaymentEnabled).not.toHaveBeenCalled()
  }))
})

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

describe('self-service API key creation limits', () => {
  it('passes the configured limits and creates the key when allowed', () => withApp(async app => {
    mocks.apiKeyCreationLimitError.mockResolvedValue(null)
    mocks.createApiKey.mockResolvedValue({ id: 'key-1', key: 'mb-secret' })
    const token = app.jwt.sign({ sub: 'user-1', role: 'user' })
    const response = await app.inject({ method: 'POST', url: '/api/users/keys', headers: { authorization: `Bearer ${token}` }, payload: { name: 'CLI' } })
    expect(response.statusCode).toBe(201)
    expect(mocks.apiKeyCreationLimitError).toHaveBeenCalledWith('user-1', { maxActive: 200, maxPerHour: 60 })
    expect(mocks.createApiKey).toHaveBeenCalledWith(expect.objectContaining({ name: 'CLI', userId: 'user-1' }))
  }))

  it('rejects creation over a limit without creating a key', () => withApp(async app => {
    mocks.apiKeyCreationLimitError.mockResolvedValue('API Key 创建过于频繁（每小时最多 60 个），请稍后再试')
    const token = app.jwt.sign({ sub: 'user-1', role: 'user' })
    const response = await app.inject({ method: 'POST', url: '/api/users/keys', headers: { authorization: `Bearer ${token}` }, payload: { name: 'CLI' } })
    expect(response.statusCode).toBe(429)
    expect(response.json().error).toContain('每小时最多 60 个')
    expect(mocks.createApiKey).not.toHaveBeenCalled()
  }))
})
