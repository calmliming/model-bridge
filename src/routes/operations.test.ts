import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ list: vi.fn(), sync: vi.fn(), health: vi.fn(), settings: vi.fn(), save: vi.fn() }))
vi.mock('../accounts/modelCatalog', () => ({ listAccountCatalogs: mocks.list, syncAccountCatalog: mocks.sync }))
vi.mock('../usage/channelHealth', async original => ({ ...await original<typeof import('../usage/channelHealth')>(),
  channelHealth: mocks.health, getHealthSettings: mocks.settings, saveHealthSettings: mocks.save }))
import { registerOperationsRoutes } from './operations'
let app: ReturnType<typeof Fastify>
let admin: string
beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify()
  await app.register(jwt, { secret: 'operations-route-test' })
  registerOperationsRoutes(app)
  admin = `Bearer ${app.jwt.sign({ role: 'admin' })}`
  mocks.list.mockResolvedValue([])
  mocks.health.mockResolvedValue({ rows: [], alerts: [] })
  mocks.settings.mockResolvedValue({ minSamples: 20, errorRatePercent: 10, ttftP95Ms: 10000 })
})
afterEach(() => app.close())
describe('operations admin API', () => {
  it('protects every read and write endpoint from users and anonymous callers', async () => {
    const user = `Bearer ${app.jwt.sign({ role: 'user' })}`
    for (const [method, url] of [['GET', '/api/admin/model-catalog'], ['POST', '/api/admin/model-catalog/a/sync'],
      ['GET', '/api/admin/channel-health'], ['GET', '/api/admin/channel-health/settings'], ['PUT', '/api/admin/channel-health/settings']] as const) {
      expect((await app.inject({ method, url })).statusCode).toBe(401)
      expect((await app.inject({ method, url, headers: { authorization: user } })).statusCode).toBe(403)
    }
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.sync).not.toHaveBeenCalled()
    expect(mocks.health).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('validates filters and settings before reaching storage', async () => {
    expect((await app.inject({ url: '/api/admin/channel-health?hours=999', headers: { authorization: admin } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PUT', url: '/api/admin/channel-health/settings', headers: { authorization: admin }, payload: { minSamples: 0 } })).statusCode).toBe(400)
    expect(mocks.health).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
    const response = await app.inject({ url: '/api/admin/channel-health?hours=6&groupBy=model&provider=openai&groupId=group-a', headers: { authorization: admin } })
    expect(response.statusCode).toBe(200)
    expect(mocks.health).toHaveBeenCalledWith({ hours: 6, groupBy: 'model', provider: 'openai', groupId: 'group-a' })
  })
})
