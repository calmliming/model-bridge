import type { PaymentConfig, PaymentProvider } from './base'
import { AlipayProvider } from './alipay'
import { AlipayWebProvider } from './alipay-web'
import { WechatPayProvider } from './wechat'

export * from './base'
export { AlipayProvider } from './alipay'
export { AlipayWebProvider } from './alipay-web'
export { WechatPayProvider } from './wechat'

let alipayProvider: AlipayProvider | null = null
let alipayWebProvider: AlipayWebProvider | null = null
let wechatProvider: WechatPayProvider | null = null

export function initPaymentProviders(config: PaymentConfig): void {
  alipayProvider = null
  alipayWebProvider = null
  wechatProvider = null
  if (config.alipay) {
    const mode = config.alipay.paymentMode ?? (config.alipay.returnUrl ? 'both' : 'qr')
    if (mode !== 'qr' && !config.alipay.returnUrl) throw new Error('ALIPAY_RETURN_URL is required for web payment')
    alipayProvider = mode !== 'web' ? new AlipayProvider(config.alipay) : null
    alipayWebProvider = mode !== 'qr' && config.alipay.returnUrl
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
