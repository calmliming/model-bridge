import { afterEach, describe, expect, it } from 'vitest'
import { getAvailableProviders, getPaymentProvider, initPaymentProviders } from './index'

const config = {
  appId: 'app_1', privateKey: 'key', alipayPublicKey: 'key', usdCnyRate: '1.00',
  returnUrl: 'https://merchant.example/api/payment/return/alipay',
}
afterEach(() => initPaymentProviders({}))

describe('contracted Alipay payment products', () => {
  it.each([
    ['qr', ['manual', 'alipay']],
    ['web', ['manual', 'alipay_web']],
    ['both', ['manual', 'alipay', 'alipay_web']],
  ] as const)('exposes only %s products', (paymentMode, providers) => {
    initPaymentProviders({ alipay: { ...config, paymentMode } })
    expect(getAvailableProviders()).toEqual(providers)
  })
  it('clears old providers when payment is disabled', () => {
    initPaymentProviders({ alipay: config })
    initPaymentProviders({})
    expect(getAvailableProviders()).toEqual(['manual'])
    expect(getPaymentProvider('alipay')).toBeNull()
    expect(getPaymentProvider('alipay_web')).toBeNull()
  })
  it('rejects web checkout without a return URL', () => {
    expect(() => initPaymentProviders({ alipay: { ...config, paymentMode: 'web', returnUrl: '' } })).toThrow(/ALIPAY_RETURN_URL/)
  })
})
