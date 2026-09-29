import { AlipaySdk, type AlipaySdkCommonResult } from 'alipay-sdk'
import { alipayCnyToUsd, parseAlipayRate } from './alipay-amount'
import type {
  PaymentNotification,
  PaymentConfig,
  RefundPaymentParams,
  RefundPaymentResult,
  RefundQueryResult,
} from './base'

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeCnyAmount(value: unknown): string | null {
  const text = String(value ?? '').trim()
  const match = text.match(/^(\d+)(?:\.(\d{1,2}))?$/)
  if (!match) return null
  return `${BigInt(match[1]!).toString()}.${(match[2] ?? '').padEnd(2, '0')}`
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function alipayError(prefix: string, result: AlipaySdkCommonResult): Error {
  return new Error(`${prefix}: ${result.sub_msg || result.msg || result.sub_code || result.code}`)
}

export function createAlipaySdk(config: NonNullable<PaymentConfig['alipay']>): AlipaySdk {
  return new AlipaySdk({
    appId: config.appId.trim(),
    privateKey: config.privateKey.replace(/\\n/g, '\n'),
    alipayPublicKey: config.alipayPublicKey.replace(/\\n/g, '\n'),
    gateway: config.gatewayUrl?.trim() || 'https://openapi.alipay.com/gateway.do',
    signType: 'RSA2',
    keyType: config.keyType ?? (config.privateKey.includes('BEGIN PRIVATE KEY') ? 'PKCS8' : 'PKCS1'),
    camelcase: false,
    timeout: 10_000,
  })
}

/** Shared official-SDK signing, notifications and transaction operations. */
export class AlipayTradeClient {
  private readonly appId: string
  protected readonly notifyUrl: string
  private readonly sellerId: string
  private readonly sellerEmail: string
  protected readonly usdCnyRate: bigint
  protected readonly sdk: AlipaySdk

  constructor(config: NonNullable<PaymentConfig['alipay']>) {
    this.appId = config.appId.trim()
    this.notifyUrl = config.notifyUrl?.trim() ?? ''
    this.sellerId = config.sellerId?.trim() ?? ''
    this.sellerEmail = config.sellerEmail?.trim() ?? ''
    this.usdCnyRate = parseAlipayRate(config.usdCnyRate)
    this.sdk = createAlipaySdk(config)
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
    if (paid && (!providerOrderId || !providerAmount || Number(providerAmount) <= 0)) {
      throw new Error('Alipay paid notification requires trade_no and a positive total_amount')
    }
    const paidAtRaw = stringValue(data.gmt_payment)
    const paidAt = paidAtRaw ? new Date(paidAtRaw).getTime() : undefined

    return {
      providerOrderId,
      orderId,
      status: paid ? 'success' : 'ignored',
      paidAmount: paid && providerAmount ? alipayCnyToUsd(Number(providerAmount), this.usdCnyRate) : undefined,
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
    }, { validateSign: true })
    if (result.code !== '10000') throw alipayError('Alipay query error', result)
    if (stringValue(result.out_trade_no) !== outTradeNo) throw new Error('Alipay query order does not match request')
    const tradeStatus = stringValue(result.trade_status)
    const paid = tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED'
    const providerAmount = normalizeCnyAmount(result.total_amount)
    if (paid && (!stringValue(result.trade_no) || !providerAmount || Number(providerAmount) <= 0)) {
      throw new Error('Alipay paid query requires trade_no and a positive total_amount')
    }
    const paidAtRaw = stringValue(result.send_pay_date)
    const paidAt = paidAtRaw ? new Date(paidAtRaw).getTime() : undefined
    return {
      providerOrderId: stringValue(result.trade_no),
      orderId: stringValue(result.out_trade_no) || outTradeNo,
      status: paid ? 'success' : 'ignored',
      paidAmount: paid && providerAmount ? alipayCnyToUsd(Number(providerAmount), this.usdCnyRate) : undefined,
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
    }, { validateSign: true })
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
    }, { validateSign: true })
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
    }, { validateSign: true })
    if (result.code !== '10000') throw alipayError('Alipay close error', result)
    return asRecord(result)
  }

  private expectedSellerMatches(data: Record<string, unknown>): boolean {
    if (!this.sellerId && !this.sellerEmail) return false
    if (this.sellerId) return stringValue(data.seller_id) === this.sellerId
    return stringValue(data.seller_email) === this.sellerEmail
  }
}
