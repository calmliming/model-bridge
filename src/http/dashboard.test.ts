import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ findApiKeyBySecret: vi.fn() }))
vi.mock('../keys/manager', () => ({ findApiKeyBySecret: mocks.findApiKeyBySecret }))
vi.mock('../db/index', () => ({
  db: { update: () => ({ set: () => ({ where: async () => undefined }) }) },
}))
vi.mock('../subscriptions/manager', () => ({
  resolveActiveSubscription: vi.fn(), hasWindowHeadroom: vi.fn(),
}))

import { requireApiKey } from '../middleware/apiKeyAuth'
import { registerDashboardRoutes } from './dashboard'

const html = '<!doctype html><html><body><div id="app"></div></body></html>'
const modelList = { object: 'list', data: [{ id: 'test-model', object: 'model' }] }
let webDist: string
let app: FastifyInstance

beforeAll(() => {
  webDist = mkdtempSync(join(tmpdir(), 'model-bridge-dashboard-'))
  writeFileSync(join(webDist, 'index.html'), html)
})
afterAll(() => {
  unlinkSync(join(webDist, 'index.html'))
  rmdirSync(webDist)
})
beforeEach(async () => {
  mocks.findApiKeyBySecret.mockReset().mockImplementation(async (secret: string) => secret === 'mb-valid' ? {
    id: 'key-1', name: 'Test', enabled: true, expiresAt: null,
    quotaLimit: null, quotaUsed: 0, userId: 'user-1', userStatus: 'active',
    userBalanceMicros: 1_000_000, accountGroupId: null,
  } : null)
  app = Fastify()
  await registerDashboardRoutes(app, webDist)
  app.get('/models', { preHandler: requireApiKey }, () => modelList)
  app.get('/models/:model', { preHandler: requireApiKey }, () => modelList.data[0])
  app.get('/v1/models', { preHandler: requireApiKey }, () => modelList)
})
afterEach(async () => { await app.close() })

describe('dashboard navigation sharing /models with the API', () => {
  it.each(['/models', '/models?tab=images'])('serves the SPA on a browser refresh at %s', async url => {
    const response = await app.inject({ url, headers: { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' } })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.headers.vary).toBe('Accept')
    expect(response.body).toBe(html)
    expect(mocks.findApiKeyBySecret).not.toHaveBeenCalled()
  })

  it('supports HEAD browser navigation without a body', async () => {
    const response = await app.inject({ method: 'HEAD', url: '/models', headers: { accept: 'text/html' } })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.body).toBe('')
  })

  it.each([undefined, '*/*', 'application/json'])('still rejects API calls without a key (Accept: %s)', async accept => {
    const response = await app.inject({ url: '/models', headers: accept ? { accept } : {} })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'missing API key' })
    expect(response.headers.vary).toBe('Accept')
  })

  it('still rejects an invalid API key', async () => {
    const response = await app.inject({ url: '/models', headers: { authorization: 'Bearer mb-invalid' } })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'invalid or disabled API key' })
    expect(mocks.findApiKeyBySecret).toHaveBeenCalledWith('mb-invalid')
  })

  it.each([
    { authorization: 'Bearer mb-valid' },
    { 'x-api-key': 'mb-valid' },
    { 'x-goog-api-key': 'mb-valid' },
  ])('returns JSON with a valid API key in %j', async headers => {
    const response = await app.inject({ url: '/models', headers: { accept: 'application/json', ...headers } })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('application/json')
    expect(response.headers.vary).toBe('Accept')
    expect(response.json()).toEqual(modelList)
    expect(mocks.findApiKeyBySecret).toHaveBeenCalledWith('mb-valid')
  })

  it.each(['/models/test-model', '/v1/models'])('keeps authentication on %s even when HTML is requested', async url => {
    const response = await app.inject({ url, headers: { accept: 'text/html' } })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'missing API key' })
  })

  it('preserves the SPA fallback and API 404 responses', async () => {
    const page = await app.inject('/overview')
    expect(page.statusCode).toBe(200)
    expect(page.body).toBe(html)
    const missingApi = await app.inject('/api/nonexistent')
    expect(missingApi.statusCode).toBe(404)
    expect(missingApi.json()).toEqual({ error: 'not found' })
  })

  it('keeps API authentication when the dashboard has not been built', async () => {
    const apiOnly = Fastify()
    await registerDashboardRoutes(apiOnly, join(webDist, 'not-built'))
    apiOnly.get('/models', { preHandler: requireApiKey }, () => modelList)
    try {
      const response = await apiOnly.inject({ url: '/models', headers: { accept: 'text/html' } })
      expect(response.statusCode).toBe(401)
      expect(response.json()).toEqual({ error: 'missing API key' })
    } finally { await apiOnly.close() }
  })
})
