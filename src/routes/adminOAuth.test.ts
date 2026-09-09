import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ insert: vi.fn(), values: vi.fn() }))
vi.mock('../db/index', () => ({ pool: {}, db: { insert: mocks.insert } }))

import { registerAdminRoutes } from './admin'

let app: ReturnType<typeof Fastify>
let authorization: string
beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubEnv('GEMINI_OAUTH_CLIENT_ID', '')
  vi.stubEnv('GEMINI_OAUTH_CLIENT_SECRET', '')
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('OAuth start must not contact upstream services')))
  mocks.insert.mockReturnValue({ values: mocks.values })
  mocks.values.mockResolvedValue(undefined)
  app = Fastify()
  await app.register(fastifyJwt, { secret: 'admin-oauth-start-test-secret' })
  registerAdminRoutes(app)
  authorization = `Bearer ${app.jwt.sign({ sub: 'admin', role: 'admin' })}`
})
afterEach(async () => {
  await app.close()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const start = (payload: Record<string, unknown> = { provider: 'gemini', name: 'gemini-01' }, token = authorization) => app.inject({
  method: 'POST', url: '/api/admin/accounts/oauth/start', headers: { authorization: token }, payload,
})

describe('admin account OAuth start', () => {
  it('reports missing Gemini credentials without returning 500 or storing a session', async () => {
    const response = await start()
    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      code: 'oauth_not_configured', provider: 'gemini',
      missingVariables: ['GEMINI_OAUTH_CLIENT_ID', 'GEMINI_OAUTH_CLIENT_SECRET'],
    })
    expect(response.json().error).toContain('Gemini')
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('does not substitute website Google login credentials for Gemini credentials', async () => {
    vi.stubEnv('GOOGLE_LOGIN_CLIENT_ID', 'website-client.apps.googleusercontent.com')
    const response = await start()
    expect(response.statusCode).toBe(503)
    expect(response.json().code).toBe('oauth_not_configured')
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('identifies a missing secret without including configured values in the response', async () => {
    vi.stubEnv('GEMINI_OAUTH_CLIENT_ID', 'configured-private-client-value')
    vi.stubEnv('GEMINI_OAUTH_CLIENT_SECRET', '   ')
    const response = await start()
    expect(response.statusCode).toBe(503)
    expect(response.json().missingVariables).toEqual(['GEMINI_OAUTH_CLIENT_SECRET'])
    expect(response.body).not.toContain('configured-private-client-value')
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('creates a PKCE authorization session using configured Gemini credentials without network calls', async () => {
    vi.stubEnv('GEMINI_OAUTH_CLIENT_ID', 'test-gemini-client')
    vi.stubEnv('GEMINI_OAUTH_CLIENT_SECRET', 'test-gemini-secret')
    const response = await start()
    expect(response.statusCode).toBe(200)
    const body = response.json()
    const url = new URL(body.authorizeUrl)
    expect(url.hostname).toBe('accounts.google.com')
    expect(url.searchParams.get('client_id')).toBe('test-gemini-client')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:1455/oauth2callback')
    expect(url.searchParams.get('state')).toBe(body.state)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(body.mode).toBe('callback')
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ state: body.state, provider: 'gemini', accountName: 'gemini-01', codeVerifier: expect.any(String) }))
    expect(response.body).not.toContain('test-gemini-secret')
    expect(response.body).not.toContain(mocks.values.mock.calls[0]![0].codeVerifier)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['claude', 'openai', 'grok'])('does not require Gemini configuration for %s', async provider => {
    expect((await start({ provider, name: 'account' })).statusCode).toBe(200)
    expect(mocks.values).toHaveBeenCalledOnce()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports a database failure without leaking SQL parameters or credentials', async () => {
    mocks.values.mockRejectedValue(new Error('query includes sensitive-pkce-value', {
      cause: Object.assign(new Error('relation oauth_sessions missing'), { code: '42P01' }),
    }))
    const response = await start({ provider: 'openai', name: 'account' })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ code: 'oauth_session_unavailable', requestId: expect.any(String) })
    expect(response.body).not.toContain('sensitive-pkce-value')
    expect(response.body).not.toContain('relation oauth_sessions missing')
  })

  it('rejects invalid input and non-admin access before storing a session', async () => {
    expect((await start({ provider: 'unknown', name: 'account' })).statusCode).toBe(400)
    expect((await start({ provider: 'gemini' })).statusCode).toBe(400)
    expect((await start(undefined, 'Bearer invalid')).statusCode).toBe(401)
    expect((await start(undefined, `Bearer ${app.jwt.sign({ sub: 'user', role: 'user' })}`)).statusCode).toBe(403)
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})
