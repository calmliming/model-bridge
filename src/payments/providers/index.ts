import type { PaymentConfig, PaymentProvider } from './base'
import { AlipayProvider } from './alipay'
import { AlipayWebProvider } from './alipay-web'
import { WechatPayProvider } from './wechat'

export * from './base'
export { AlipayProvider } from './alipay'
export { AlipayWebProvider } from './alipay-web'
export { WechatPayProvider } from './wechat'

let paymentConfig: PaymentConfig | null = null
let alipayProvider: AlipayProvider | null = null
let alipayWebProvider: AlipayWebProvider | null = null
let wechatProvider: WechatPayProvider | null = null

export function initPaymentProviders(config: PaymentConfig): void {
  paymentConfig = config

  if (config.alipay) {
    alipayProvider = new AlipayProvider(config.alipay)
    alipayWebProvider = config.alipay.returnUrl
      ? new AlipayWebProvider({ ...config.alipay, returnUrl: config.alipay.returnUrl })
      : null
  }

  if (config.wechat) {
    wechatProvider = new WechatPayProvider(config.wechat)
  }
}

export function getPaymentProvider(provider: 'alipay' | 'alipay_web' | 'wechat'): PaymentProvider | null {
  if (provider === 'alipay') return alipayProvider
  if (provider === 'alipay_web') return alipayWebProvider
  if (provider === 'wechat') return wechatProvider
  return null
}

export function getAvailableProviders(): Array<'alipay' | 'alipay_web' | 'wechat' | 'manual'> {
  const providers: Array<'alipay' | 'alipay_web' | 'wechat' | 'manual'> = ['manual']
  if (alipayProvider) providers.push('alipay')
  if (alipayWebProvider) providers.push('alipay_web')
  if (wechatProvider) providers.push('wechat')
  return providers
}
