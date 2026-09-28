import Fastify from 'fastify'
import { describe, expect, it, vi, beforeEach } from 'vitest'
const mocks = vi.hoisted(() => ({ verify: vi.fn(), apply: vi.fn(), create: vi.fn(), get: vi.fn() }))
vi.mock('../payments/providers/waffo', () => ({ verifyWaffoEvent: mocks.verify }))
vi.mock('../subscriptions/checkout', () => ({ createSubscriptionCheckout: mocks.create, getSubscriptionCheckout: mocks.get, applyWaffoEvent: mocks.apply }))
vi.mock('../middleware/userAuth', () => ({ requireUser: async (req: any, reply: any) => {
  if (req.headers.authorization !== 'Bearer test-user') return reply.code(401).send({ error: 'unauthorized' })
  req.currentUser = { id: 'user_1', email: 'buyer@example.com' }
} }))
vi.mock('../db/index', () => ({ pool: {} }))
import { registerWaffoRoutes } from './waffo'
import { SubscriptionError } from '../subscriptions/manager'
beforeEach(() => vi.resetAllMocks())

describe('Waffo routes', () => {
  async function withApp(run: (app: ReturnType<typeof Fastify>) => Promise<void>) {
    const app = Fastify()
    app.post('/ordinary-json', async req => req.body)
    await registerWaffoRoutes(app)
    try { await run(app) } finally { await app.close() }
  }
  it('preserves the raw JSON body only for the webhook route', () => withApp(async app => {
    const raw = '{\n "eventType" : "subscription.activated"\n}'
    mocks.verify.mockReturnValue({ eventType: 'subscription.activated' })
    const response = await app.inject({ method: 'POST', url: '/api/payment/callback/waffo', headers: { 'content-type': 'application/json', 'x-waffo-signature': 'signed' }, payload: raw })
    expect(response.statusCode).toBe(200)
    expect(response.body).toBe('OK')
    expect(mocks.verify).toHaveBeenCalledWith(raw, 'signed')
    const normal = await app.inject({ method: 'POST', url: '/ordinary-json', payload: { a: 1 } })
    expect(normal.json()).toEqual({ a: 1 })
  }))
  it('never acknowledges a failed database transaction', () => withApp(async app => {
    mocks.verify.mockReturnValue({})
    mocks.apply.mockRejectedValue(new Error('database unavailable'))
    expect((await app.inject({ method: 'POST', url: '/api/payment/callback/waffo', payload: {} })).statusCode).toBe(500)
  }))
  it('never processes unverified webhooks', () => withApp(async app => {
    mocks.verify.mockImplementation(() => { throw new SubscriptionError('invalid signature', 401) })
    expect((await app.inject({ method: 'POST', url: '/api/payment/callback/waffo', payload: {} })).statusCode).toBe(401)
    expect(mocks.apply).not.toHaveBeenCalled()
  }))
  it('requires authentication and validates plan ids before creating a checkout', () => withApp(async app => {
    expect((await app.inject({ method: 'POST', url: '/api/users/subscriptions/checkout', payload: { planId: 'p' } })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/api/users/subscriptions/checkout', headers: { authorization: 'Bearer test-user' }, payload: { planId: '' } })).statusCode).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  }))
  it('binds checkout creation and status queries to the authenticated user', () => withApp(async app => {
    mocks.create.mockResolvedValue({ id: 'sc_1' })
    const headers = { authorization: 'Bearer test-user' }
    expect((await app.inject({ method: 'POST', url: '/api/users/subscriptions/checkout', headers, payload: { planId: 'plan_lite', userId: 'victim', price: 0.01 } })).statusCode).toBe(201)
    expect(mocks.create).toHaveBeenCalledWith({ id: 'user_1', email: 'buyer@example.com' }, 'plan_lite')
    await app.inject({ url: '/api/users/subscription-checkouts/sc_1', headers })
    expect(mocks.get).toHaveBeenCalledWith('user_1', 'sc_1')
  }))
})
