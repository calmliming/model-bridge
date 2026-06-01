import type { PaymentConfig, PaymentProvider } from './base'
import { AlipayProvider } from './alipay'
import { WechatPayProvider } from './wechat'

export * from './base'
export { AlipayProvider } from './alipay'
export { WechatPayProvider } from './wechat'

let paymentConfig: PaymentConfig | null = null
let alipayProvider: AlipayProvider | null = null
let wechatProvider: WechatPayProvider | null = null

export function initPaymentProviders(config: PaymentConfig): void {
  paymentConfig = config

  if (config.alipay) {
    alipayProvider = new AlipayProvider(config.alipay)
  }

  if (config.wechat) {
    wechatProvider = new WechatPayProvider(config.wechat)
  }
}

export function getPaymentProvider(provider: 'alipay' | 'wechat'): PaymentProvider | null {
  if (provider === 'alipay') return alipayProvider
  if (provider === 'wechat') return wechatProvider
  return null
}

export function getAvailableProviders(): Array<'alipay' | 'wechat' | 'manual'> {
  const providers: Array<'alipay' | 'wechat' | 'manual'> = ['manual']
  if (alipayProvider) providers.push('alipay')
  if (wechatProvider) providers.push('wechat')
  return providers
}
