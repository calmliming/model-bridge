import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ list: vi.fn(), user: vi.fn() }))
vi.mock('../usage/requestLogs', () => ({ listRequestLogs: mocks.list }))
vi.mock('../users/manager', () => ({ getUserById: mocks.user }))
import { registerRequestLogRoutes } from './requestLogs'

let app: ReturnType<typeof Fastify>
let admin: string
let user: string
beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify()
  await app.register(jwt, { secret: 'request-logs-test' })
  registerRequestLogRoutes(app)
  admin = `Bearer ${app.jwt.sign({ role: 'admin' })}`
  user = `Bearer ${app.jwt.sign({ role: 'user', sub: 'owner-1' })}`
  mocks.user.mockResolvedValue({ id: 'owner-1', status: 'active' })
  mocks.list.mockResolvedValue({ logs: [], total: 0 })
})
afterEach(() => app.close())

describe('request log API', () => {
  it('requires the appropriate role on both endpoints', async () => {
    for (const url of ['/api/admin/logs', '/api/users/logs']) {
      expect((await app.inject({ url })).statusCode).toBe(401)
    }
    expect((await app.inject({ url: '/api/admin/logs', headers: { authorization: user } })).statusCode).toBe(403)
    expect((await app.inject({ url: '/api/users/logs', headers: { authorization: admin } })).statusCode).toBe(403)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('validates manufacturer, pagination and time filters before storage', async () => {
    for (const query of ['manufacturer=grsai', 'manufacturer=sub2api', 'pageSize=101', 'page=0', 'status=invalid',
      'kind=invalid', 'startDate=10&endDate=1', 'id=invalid%20id', 'model=' + 'a'.repeat(161)]) {
      expect((await app.inject({ url: `/api/admin/logs?${query}`, headers: { authorization: admin } })).statusCode).toBe(400)
    }
    expect(mocks.list).not.toHaveBeenCalled()
    expect((await app.inject({ url: '/api/admin/logs?manufacturer=openai&status=running&kind=image&page=2&pageSize=50',
      headers: { authorization: admin } })).statusCode).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith(2, 50, { manufacturer: 'openai', status: 'running', kind: 'image' }, undefined)
  })

  it('scopes user logs to the authenticated owner even when another user is requested', async () => {
    expect((await app.inject({ url: '/api/users/logs?userId=owner-2&manufacturer=minimax', headers: { authorization: user } })).statusCode).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith(1, 20, { manufacturer: 'minimax' }, 'owner-1')
    mocks.user.mockResolvedValue({ id: 'owner-1', status: 'disabled' })
    expect((await app.inject({ url: '/api/users/logs', headers: { authorization: user } })).statusCode).toBe(401)
    expect(mocks.list).toHaveBeenCalledTimes(1)
  })
})
