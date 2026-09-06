import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  pageExec: vi.fn(),
  exec: vi.fn(),
  checkNotifySignV2: vi.fn(),
  constructor: vi.fn(),
}))

vi.mock('alipay-sdk', () => ({
  AlipaySdk: class {
    constructor(config: unknown) { mocks.constructor(config) }
    pageExec = mocks.pageExec
    exec = mocks.exec
    checkNotifySignV2 = mocks.checkNotifySignV2
  },
}))

import { AlipayWebProvider } from './alipay-web'

function provider() {
  return new AlipayWebProvider({
    appId: 'app_1',
    privateKey: 'raw-pkcs1-key',
    alipayPublicKey: 'alipay-public-key',
    gatewayUrl: 'https://openapi-sandbox.dl.alipaydev.com/gateway.do',
    notifyUrl: 'https://merchant.example/api/payment/callback/alipay',
    returnUrl: 'https://merchant.example/api/payment/return/alipay',
    sellerId: 'seller_1',
    usdCnyRate: '7.20',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.checkNotifySignV2.mockReturnValue(true)
  mocks.pageExec.mockReturnValue('<form action="https://openapi.alipay.com/gateway.do"></form>')
})

describe('AlipayWebProvider', () => {
  it('uses the verified SDK ESM export and pageExec POST form', async () => {
    const result = await provider().createPayment({
      orderId: 'po_1',
      amount: 10,
      amountMicros: 10_000_000,
      subject: '充值',
      userId: 'user_1',
      mode: 'web',
    })

    expect(mocks.constructor).toHaveBeenCalledWith(expect.objectContaining({
      signType: 'RSA2',
      keyType: 'PKCS1',
      camelcase: false,
    }))
    expect(mocks.pageExec).toHaveBeenCalledWith(
      'alipay.trade.page.pay',
      'POST',
      expect.objectContaining({
        notifyUrl: 'https://merchant.example/api/payment/callback/alipay',
        returnUrl: 'https://merchant.example/api/payment/return/alipay',
        bizContent: expect.objectContaining({
          out_trade_no: 'po_1',
          total_amount: '72.00',
          product_code: 'FAST_INSTANT_TRADE_PAY',
        }),
      }),
    )
    expect(result).toMatchObject({
      providerOrderId: 'po_1',
      providerAmount: '72.00',
      providerCurrency: 'CNY',
      paymentHtml: expect.stringContaining('<form'),
    })
  })

  it('verifies paid notifications and runtime business identity', async () => {
    const result = await provider().verifyNotification({
      sign: 'signature',
      sign_type: 'RSA2',
      app_id: 'app_1',
      seller_id: 'seller_1',
      notify_id: 'notify_1',
      out_trade_no: 'po_1',
      trade_no: 'trade_1',
      trade_status: 'TRADE_SUCCESS',
      total_amount: '72',
      gmt_payment: '2026-09-04 12:00:00',
    })

    expect(mocks.checkNotifySignV2).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      status: 'success',
      orderId: 'po_1',
      providerOrderId: 'trade_1',
      paidProviderAmount: '72.00',
      tradeStatus: 'TRADE_SUCCESS',
    })
  })

  it('acknowledges refund-shaped notifications without treating them as payment', async () => {
    const result = await provider().verifyNotification({
      sign: 'signature',
      sign_type: 'RSA2',
      app_id: 'app_1',
      seller_id: 'seller_1',
      out_trade_no: 'po_1',
      trade_no: 'trade_1',
      trade_status: 'TRADE_SUCCESS',
      total_amount: '72.00',
      refund_fee: '1.00',
    })
    expect(result.status).toBe('ignored')
  })

  it('maps query, refund, refund query, and close methods', async () => {
    mocks.exec
      .mockResolvedValueOnce({
        code: '10000',
        out_trade_no: 'po_1',
        trade_no: 'trade_1',
        trade_status: 'WAIT_BUYER_PAY',
        total_amount: '72.00',
      })
      .mockResolvedValueOnce({ code: '10000', trade_no: 'trade_1', fund_change: 'N' })
      .mockResolvedValueOnce({ code: '10000', refund_status: 'REFUND_SUCCESS', refund_amount: '7.20' })
      .mockResolvedValueOnce({ code: '10000', out_trade_no: 'po_1' })

    const current = provider()
    await expect(current.queryOrder('po_1')).resolves.toMatchObject({ status: 'ignored' })
    await expect(current.refund!({
      orderId: 'po_1',
      providerOrderId: 'trade_1',
      outRequestNo: 'rf_1',
      providerAmount: '7.20',
    })).resolves.toMatchObject({ status: 'unknown' })
    await expect(current.queryRefund!({
      orderId: 'po_1',
      outRequestNo: 'rf_1',
      providerAmount: '7.20',
    })).resolves.toMatchObject({ status: 'succeeded', providerAmount: '7.20' })
    await expect(current.closeOrder!('po_1')).resolves.toMatchObject({ code: '10000' })

    expect(mocks.exec.mock.calls.map((call) => call[0])).toEqual([
      'alipay.trade.query',
      'alipay.trade.refund',
      'alipay.trade.fastpay.refund.query',
      'alipay.trade.close',
    ])
  })
})
