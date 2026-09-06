import { AlipaySdk, type AlipaySdkCommonResult } from 'alipay-sdk'
import type {
  CreatePaymentParams,
  CreatePaymentResult,
  PaymentNotification,
  PaymentProvider,
  RefundPaymentParams,
  RefundPaymentResult,
  RefundQueryResult,
} from './base'

const ORDER_TTL_MS = 30 * 60_000
const USD_MICROS = 1_000_000n
const RATE_SCALE = 10_000n

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeCnyAmount(value: unknown): string | null {
  const text = String(value ?? '').trim()
  const match = text.match(/^(\d+)(?:\.(\d{1,2}))?$/)
  if (!match) return null
  return `${BigInt(match[1]!).toString()}.${(match[2] ?? '').padEnd(2, '0')}`
}

function parseRate(value: string): bigint {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,4}))?$/)
  if (!match) throw new Error('ALIPAY_USD_CNY_RATE must be a positive decimal with up to 4 places')
  const scaled = BigInt(match[1]!) * RATE_SCALE + BigInt((match[2] ?? '').padEnd(4, '0'))
  if (scaled <= 0n) throw new Error('ALIPAY_USD_CNY_RATE must be positive')
  return scaled
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function alipayError(prefix: string, result: AlipaySdkCommonResult): Error {
  return new Error(`${prefix}: ${result.sub_msg || result.msg || result.sub_code || result.code}`)
}

/** Official-SDK implementation for AI web application payment. */
export class AlipayWebProvider implements PaymentProvider {
  private readonly appId: string
  private readonly notifyUrl: string
  private readonly returnUrl: string
  private readonly sellerId: string
  private readonly sellerEmail: string
  private readonly usdCnyRate: bigint
  private readonly sdk: AlipaySdk

  constructor(config: {
    appId: string
    privateKey: string
    alipayPublicKey: string
    gatewayUrl?: string
    notifyUrl?: string
    returnUrl: string
    sellerId?: string
    sellerEmail?: string
    usdCnyRate: string
  }) {
    this.appId = config.appId.trim()
    this.notifyUrl = config.notifyUrl?.trim() ?? ''
    this.returnUrl = config.returnUrl.trim()
    this.sellerId = config.sellerId?.trim() ?? ''
    this.sellerEmail = config.sellerEmail?.trim() ?? ''
    this.usdCnyRate = parseRate(config.usdCnyRate)
    if (!this.returnUrl) throw new Error('ALIPAY_RETURN_URL is required for AI web application payment')
    this.sdk = new AlipaySdk({
      appId: this.appId,
      privateKey: config.privateKey,
      alipayPublicKey: config.alipayPublicKey,
      gateway: config.gatewayUrl?.trim() || 'https://openapi.alipay.com/gateway.do',
      signType: 'RSA2',
      keyType: 'PKCS1',
      camelcase: false,
    })
  }

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    const providerAmount = this.usdMicrosToCny(params.amountMicros)
    const requestOptions: Record<string, unknown> = {
      returnUrl: this.returnUrl,
      bizContent: {
        out_trade_no: params.orderId,
        total_amount: providerAmount,
        subject: params.subject,
        body: params.body || params.subject,
        product_code: 'FAST_INSTANT_TRADE_PAY',
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

  async verifyNotification(data: Record<string, unknown>): Promise<PaymentNotification> {
    if (stringValue(data.sign_type).toUpperCase() !== 'RSA2') {
      throw new Error('Alipay notification sign_type must be RSA2')
    }
    if (!this.sdk.checkNotifySignV2(data)) {
      throw new Error('Alipay notification signature verification failed')
    }
    if (stringValue(data.app_id) !== this.appId) {
      throw new Error('Alipay notification app_id does not match runtime configuration')
    }
    if (!this.expectedSellerMatches(data)) {
      throw new Error('Alipay notification seller does not match runtime configuration')
    }

    const orderId = stringValue(data.out_trade_no)
    if (!orderId) throw new Error('Alipay notification is missing out_trade_no')
    const providerOrderId = stringValue(data.trade_no)
    const tradeStatus = stringValue(data.trade_status)
    const providerAmount = normalizeCnyAmount(data.total_amount)
    const isNonPaymentEvent = Boolean(data.out_biz_no || data.gmt_refund || data.refund_fee)
    const paid = !isNonPaymentEvent && (tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED')
    const paidAtRaw = stringValue(data.gmt_payment)
    const paidAt = paidAtRaw ? new Date(paidAtRaw).getTime() : undefined

    return {
      providerOrderId,
      orderId,
      status: paid ? 'success' : 'ignored',
      paidAmount: paid && providerAmount ? Number(providerAmount) / this.rateAsNumber() : undefined,
      paidProviderAmount: paid ? providerAmount ?? undefined : undefined,
      paidAt: paid && Number.isFinite(paidAt) ? paidAt : undefined,
      tradeStatus,
      rawData: data,
    }
  }

  verifyReturn(data: Record<string, unknown>): boolean {
    if (!stringValue(data.sign) || stringValue(data.sign_type).toUpperCase() !== 'RSA2') return false
    if (stringValue(data.app_id) && stringValue(data.app_id) !== this.appId) return false
    return this.sdk.checkNotifySignV2(data)
  }

  async queryOrder(outTradeNo: string): Promise<PaymentNotification> {
    const result = await this.sdk.exec('alipay.trade.query', {
      bizContent: { out_trade_no: outTradeNo },
    })
    if (result.code !== '10000') throw alipayError('Alipay query error', result)
    const tradeStatus = stringValue(result.trade_status)
    const paid = tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED'
    const providerAmount = normalizeCnyAmount(result.total_amount)
    const paidAtRaw = stringValue(result.send_pay_date)
    const paidAt = paidAtRaw ? new Date(paidAtRaw).getTime() : undefined
    return {
      providerOrderId: stringValue(result.trade_no),
      orderId: stringValue(result.out_trade_no) || outTradeNo,
      status: paid ? 'success' : 'ignored',
      paidAmount: paid && providerAmount ? Number(providerAmount) / this.rateAsNumber() : undefined,
      paidProviderAmount: paid ? providerAmount ?? undefined : undefined,
      paidAt: paid && Number.isFinite(paidAt) ? paidAt : undefined,
      tradeStatus,
      rawData: asRecord(result),
    }
  }

  async refund(params: RefundPaymentParams): Promise<RefundPaymentResult> {
    const tradeReference = params.providerOrderId
      ? { trade_no: params.providerOrderId }
      : { out_trade_no: params.orderId }
    const result = await this.sdk.exec('alipay.trade.refund', {
      bizContent: {
        ...tradeReference,
        refund_amount: params.providerAmount,
        out_request_no: params.outRequestNo,
        ...(params.reason ? { refund_reason: params.reason } : {}),
      },
    })
    if (result.code !== '10000') throw alipayError('Alipay refund error', result)
    return {
      outRequestNo: params.outRequestNo,
      providerOrderId: stringValue(result.trade_no) || params.providerOrderId || undefined,
      status: result.fund_change === 'Y' ? 'succeeded' : 'unknown',
      providerAmount: normalizeCnyAmount(result.refund_fee) ?? undefined,
      rawData: asRecord(result),
    }
  }

  async queryRefund(params: RefundPaymentParams): Promise<RefundQueryResult> {
    const result = await this.sdk.exec('alipay.trade.fastpay.refund.query', {
      bizContent: {
        out_trade_no: params.orderId,
        out_request_no: params.outRequestNo,
      },
    })
    if (result.code !== '10000') throw alipayError('Alipay refund query error', result)
    const refundStatus = stringValue(result.refund_status)
    return {
      outRequestNo: params.outRequestNo,
      status: refundStatus === 'REFUND_SUCCESS' ? 'succeeded' : refundStatus ? 'pending' : 'unknown',
      providerAmount: normalizeCnyAmount(result.refund_amount) ?? undefined,
      rawData: asRecord(result),
    }
  }

  async closeOrder(orderId: string): Promise<Record<string, unknown>> {
    const result = await this.sdk.exec('alipay.trade.close', {
      bizContent: { out_trade_no: orderId },
    })
    if (result.code !== '10000') throw alipayError('Alipay close error', result)
    return asRecord(result)
  }

  private expectedSellerMatches(data: Record<string, unknown>): boolean {
    if (!this.sellerId && !this.sellerEmail) return false
    return Boolean(
      (this.sellerId && stringValue(data.seller_id) === this.sellerId) ||
      (this.sellerEmail && stringValue(data.seller_email) === this.sellerEmail)
    )
  }

  private usdMicrosToCny(amountMicros: number): string {
    if (!Number.isSafeInteger(amountMicros) || amountMicros <= 0) {
      throw new Error('payment amount must be a positive safe integer in micro-USD')
    }
    const denominator = USD_MICROS * RATE_SCALE
    const cents = (BigInt(amountMicros) * this.usdCnyRate * 100n + denominator / 2n) / denominator
    if (cents < 1n) throw new Error('payment amount converts to less than CNY 0.01')
    return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`
  }

  private rateAsNumber(): number {
    return Number(this.usdCnyRate) / Number(RATE_SCALE)
  }
}
