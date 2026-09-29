import { AlipayTradeClient } from './alipay-client'
import { usdMicrosToAlipayCny } from './alipay-amount'
import type { CreatePaymentParams, CreatePaymentResult, PaymentConfig, PaymentProvider } from './base'

const ORDER_TTL_MS = 30 * 60_000

/** Official-SDK checkout for the contracted web payment product. */
export class AlipayWebProvider extends AlipayTradeClient implements PaymentProvider {
  private readonly returnUrl: string

  constructor(config: NonNullable<PaymentConfig['alipay']> & { returnUrl: string }) {
    super(config)
    this.returnUrl = config.returnUrl.trim()
    if (!this.returnUrl) throw new Error('ALIPAY_RETURN_URL is required for web payment')
  }

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    const providerAmount = usdMicrosToAlipayCny(params.amountMicros, this.usdCnyRate)
    const requestOptions: Record<string, unknown> = {
      returnUrl: this.returnUrl,
      bizContent: {
        out_trade_no: params.orderId,
        total_amount: providerAmount,
        subject: params.subject,
        body: params.body || params.subject,
        product_code: 'FAST_INSTANT_TRADE_PAY',
        timeout_express: '30m',
      },
    }
    if (this.notifyUrl) requestOptions.notifyUrl = this.notifyUrl
    const paymentHtml = this.sdk.pageExec('alipay.trade.page.pay', 'POST', requestOptions)
    return {
      providerOrderId: params.orderId,
      paymentHtml,
      providerAmount,
      providerCurrency: 'CNY',
      expiresAt: Date.now() + ORDER_TTL_MS,
    }
  }
}
