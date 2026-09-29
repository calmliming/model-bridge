import { createSign, generateKeyPairSync } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AlipayProvider } from './alipay'
import { AlipaySdk } from 'alipay-sdk'

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})
const execMock = vi.spyOn(AlipaySdk.prototype, 'exec')

function provider(rate = '1.00') {
  return new AlipayProvider({
    appId: 'test-app', privateKey, alipayPublicKey: publicKey, usdCnyRate: rate, sellerId: 'seller_1',
  })
}

beforeEach(() => {
  execMock.mockReset()
})

afterEach(() => execMock.mockReset())

describe('Alipay QR recharge rate', () => {
  it.each([
    ['1.00', 500_000, '0.50'],
    ['1.00', 1_000_000, '1.00'],
    ['7.20', 500_000, '3.60'],
    ['3.3333', 1_000_000, '3.33'],
    ['1.00', 1_005_000, '1.01'],
  ])('charges rate %s for %i wallet micros as CNY %s', async (rate, amountMicros, expected) => {
    execMock.mockResolvedValue({ code: '10000', msg: 'Success', out_trade_no: 'po_1', qr_code: 'https://pay.example/qr' })
    const result = await provider(rate).createPayment({
      orderId: 'po_1', amount: amountMicros / 1_000_000, amountMicros, subject: '充值', userId: 'user_1',
    })
    expect(execMock).toHaveBeenCalledWith('alipay.trade.precreate', expect.objectContaining({
      bizContent: expect.objectContaining({ total_amount: expected }),
    }), { validateSign: true })
    expect(result).toMatchObject({ providerAmount: expected, providerCurrency: 'CNY' })
  })

  it('returns the signed CNY amount separately from the current conversion rate', async () => {
    const data: Record<string, string> = {
      app_id: 'test-app', seller_id: 'seller_1', out_trade_no: 'po_1', trade_no: 'trade_1', trade_status: 'TRADE_SUCCESS',
      total_amount: '3.60', gmt_payment: '2026-09-28 12:00:00', sign_type: 'RSA2',
    }
    const text = Object.keys(data).filter(key => key !== 'sign_type').sort()
      .map(key => `${key}=${data[key]}`).join('&')
    data.sign = createSign('RSA-SHA256').update(text).sign(privateKey, 'base64')
    await expect(provider().verifyNotification(data)).resolves.toMatchObject({
      status: 'success', paidProviderAmount: '3.60', paidAmount: 3.6,
    })
  })

  it('preserves the queried CNY amount for order-level validation', async () => {
    execMock.mockResolvedValue({ msg: 'Success',
      code: '10000', out_trade_no: 'po_1', trade_no: 'trade_1',
      trade_status: 'TRADE_SUCCESS', total_amount: '0.50',
    })
    await expect(provider().queryOrder('po_1')).resolves.toMatchObject({
      status: 'success', paidProviderAmount: '0.50', paidAmount: 0.5,
    })
  })

  it.each(['0', '-1', 'abc', '1.00001'])('rejects invalid recharge rate %s', rate => {
    expect(() => provider(rate)).toThrow(/ALIPAY_USD_CNY_RATE/)
  })

  it('rejects a sub-cent payment before submitting it to Alipay', async () => {
    await expect(provider().createPayment({
      orderId: 'po_1', amount: 0.001, amountMicros: 1_000, subject: '充值', userId: 'user_1',
    })).rejects.toThrow(/less than CNY 0.01/)
    expect(execMock).not.toHaveBeenCalled()
  })
})
