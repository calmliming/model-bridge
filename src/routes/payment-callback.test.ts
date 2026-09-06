import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import fastifyFormbody from '@fastify/formbody'

const mocks = vi.hoisted(() => ({
  handlePaymentNotification: vi.fn(),
  queryPaymentOrder: vi.fn(),
  verifyReturn: vi.fn(),
}))

vi.mock('../payments/manager', () => ({
  handlePaymentNotification: mocks.handlePaymentNotification,
  queryPaymentOrder: mocks.queryPaymentOrder,
}))

vi.mock('../payments/providers/index', () => ({
  getPaymentProvider: vi.fn(() => ({ verifyReturn: mocks.verifyReturn })),
}))

import { registerPaymentCallbackRoutes } from './payment-callback'

async function app() {
  const server = Fastify({ logger: false })
  await server.register(fastifyFormbody)
  registerPaymentCallbackRoutes(server)
  await server.ready()
  return server
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.handlePaymentNotification.mockResolvedValue({ success: true, orderId: 'po_1' })
  mocks.queryPaymentOrder.mockResolvedValue({ id: 'po_1', status: 'paid' })
  mocks.verifyReturn.mockReturnValue(true)
})

describe('payment callback routes', () => {
  it('parses Alipay form notifications and returns exact success text', async () => {
    const server = await app()
    const response = await server.inject({
      method: 'POST',
      url: '/api/payment/callback/alipay',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'notify_id=n1&out_trade_no=po_1&trade_status=TRADE_SUCCESS',
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toBe('success')
    expect(mocks.handlePaymentNotification).toHaveBeenCalledWith({
      provider: 'alipay',
      data: expect.objectContaining({ notify_id: 'n1', out_trade_no: 'po_1' }),
    })
    await server.close()
  })

  it('verifies return parameters then confirms status through active query', async () => {
    const server = await app()
    const response = await server.inject({
      method: 'GET',
      url: '/api/payment/return/alipay?out_trade_no=po_1&sign=s&sign_type=RSA2',
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('支付已确认')
    expect(mocks.verifyReturn).toHaveBeenCalled()
    expect(mocks.queryPaymentOrder).toHaveBeenCalledWith({ id: 'po_1' })
    await server.close()
  })

  it('renders a neutral return page without order context', async () => {
    const server = await app()
    const response = await server.inject({ method: 'GET', url: '/api/payment/return/alipay' })
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('未发现订单上下文')
    expect(mocks.queryPaymentOrder).not.toHaveBeenCalled()
    await server.close()
  })
})
