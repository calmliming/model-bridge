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
  it.each(['application/xml', 'text/xml; charset=utf-8'])('accepts a WeChat %s notification', async contentType => {
    const server = await app()
    try {
      const response = await server.inject({ method: 'POST', url: '/api/payment/callback/wechat',
        headers: { 'content-type': contentType }, payload: '<xml><return_code><![CDATA[SUCCESS]]></return_code><out_trade_no><![CDATA[po_1]]></out_trade_no><total_fee>7200</total_fee></xml>' })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toContain('application/xml')
      expect(response.body).toContain('<return_code><![CDATA[SUCCESS]]>')
      expect(mocks.handlePaymentNotification).toHaveBeenCalledWith({ provider: 'wechat',
        data: { return_code: 'SUCCESS', out_trade_no: 'po_1', total_fee: '7200' } })
    } finally { await server.close() }
  })

  it('rejects duplicate fields without processing payment and keeps XML out of Alipay routes', async () => {
    const server = await app()
    try {
      const response = await server.inject({ method: 'POST', url: '/api/payment/callback/wechat',
        headers: { 'content-type': 'application/xml' }, payload: '<xml><sign>A</sign><sign>B</sign></xml>' })
      expect(response.body).toContain('<return_code><![CDATA[FAIL]]>')
      expect(mocks.handlePaymentNotification).not.toHaveBeenCalled()
      const other = await server.inject({ method: 'POST', url: '/api/payment/callback/alipay',
        headers: { 'content-type': 'application/xml' }, payload: '<xml/>' })
      expect(other.statusCode).toBe(415)
    } finally { await server.close() }
  })
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
