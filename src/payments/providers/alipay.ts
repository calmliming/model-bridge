import { AlipayTradeClient } from './alipay-client'
import { usdMicrosToAlipayCny } from './alipay-amount'
import type { CreatePaymentParams, CreatePaymentResult, PaymentProvider } from './base'

/** 支付宝当面付扫码支付，与网页支付共用 SDK 验签及交易校验。 */
export class AlipayProvider extends AlipayTradeClient implements PaymentProvider {
  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    const providerAmount = usdMicrosToAlipayCny(params.amountMicros, this.usdCnyRate)
    const result = await this.sdk.exec('alipay.trade.precreate', {
      ...(this.notifyUrl ? { notifyUrl: this.notifyUrl } : {}),
      bizContent: {
        out_trade_no: params.orderId,
        total_amount: providerAmount,
        subject: params.subject,
        body: params.body || params.subject,
        timeout_express: '30m',
      },
    }, { validateSign: true })
    if (result.code !== '10000') {
      throw new Error('Alipay precreate error: ' + (result.sub_msg || result.msg || result.sub_code || result.code))
    }
    if (result.out_trade_no !== params.orderId || typeof result.qr_code !== 'string' || !result.qr_code) {
      throw new Error('Alipay precreate response is missing the requested order or QR code')
    }
    return {
      providerOrderId: params.orderId,
      paymentUrl: result.qr_code,
      qrCode: result.qr_code,
      providerAmount,
      providerCurrency: 'CNY',
      expiresAt: Date.now() + 30 * 60_000,
    }
  }
}
