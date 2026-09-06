import { createSign, createVerify } from 'node:crypto'
import type {
  CreatePaymentParams,
  CreatePaymentResult,
  PaymentNotification,
  PaymentProvider,
} from './base'

/**
 * 支付宝支付提供商
 * 使用当面付（扫码支付）API
 */
export class AlipayProvider implements PaymentProvider {
  private readonly appId: string
  private readonly privateKey: string
  private readonly alipayPublicKey: string
  private readonly gatewayUrl: string
  private readonly notifyUrl: string
  private readonly returnUrl: string

  constructor(config: {
    appId: string
    privateKey: string
    alipayPublicKey: string
    gatewayUrl?: string
    notifyUrl?: string
    returnUrl?: string
  }) {
    this.appId = config.appId
    this.privateKey = config.privateKey
    this.alipayPublicKey = config.alipayPublicKey
    this.gatewayUrl = config.gatewayUrl || 'https://openapi.alipay.com/gateway.do'
    this.notifyUrl = config.notifyUrl ?? ''
    this.returnUrl = config.returnUrl ?? ''
  }

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    const amountCny = this.usdToCny(params.amount)
    const bizContent = {
      out_trade_no: params.orderId,
      total_amount: amountCny.toFixed(2),
      subject: params.subject,
      body: params.body || params.subject,
      timeout_express: '30m',
    }

    const commonParams = {
      app_id: this.appId,
      method: 'alipay.trade.precreate', // 当面付-扫码支付
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: this.formatDateTime(new Date()),
      version: '1.0',
      notify_url: this.notifyUrl,
      biz_content: JSON.stringify(bizContent),
    }

    const sign = this.sign(commonParams)
    const requestParams = { ...commonParams, sign }

    const response = await fetch(this.gatewayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(requestParams as Record<string, string>),
    })

    const result = (await response.json()) as Record<string, any>
    const responseData = result.alipay_trade_precreate_response as Record<string, any>

    if (responseData.code !== '10000') {
      throw new Error(`Alipay error: ${responseData.sub_msg || responseData.msg}`)
    }

    return {
      providerOrderId: responseData.out_trade_no,
      paymentUrl: responseData.qr_code,
      qrCode: responseData.qr_code,
      expiresAt: Date.now() + 30 * 60_000,
    }
  }

  async verifyNotification(data: Record<string, unknown>): Promise<PaymentNotification> {
    // 验证签名
    const sign = data.sign as string
    const signType = data.sign_type as string
    if (!sign || signType !== 'RSA2') {
      throw new Error('Invalid signature')
    }

    const params = { ...data }
    delete params.sign
    delete params.sign_type

    if (!this.verify(params, sign)) {
      throw new Error('Signature verification failed')
    }

    const tradeStatus = data.trade_status as string
    const status = tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED'
      ? 'success'
      : 'failed'

    return {
      providerOrderId: data.trade_no as string,
      orderId: data.out_trade_no as string,
      status,
      paidAmount: status === 'success' ? this.cnyToUsd(Number(data.total_amount)) : undefined,
      paidAt: status === 'success' ? new Date(data.gmt_payment as string).getTime() : undefined,
      rawData: data,
    }
  }

  async queryOrder(outTradeNo: string): Promise<PaymentNotification> {
    const bizContent = { out_trade_no: outTradeNo }
    const commonParams = {
      app_id: this.appId,
      method: 'alipay.trade.query',
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: this.formatDateTime(new Date()),
      version: '1.0',
      biz_content: JSON.stringify(bizContent),
    }

    const sign = this.sign(commonParams)
    const requestParams = { ...commonParams, sign }

    const response = await fetch(this.gatewayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(requestParams as Record<string, string>),
    })

    const result = (await response.json()) as Record<string, any>
    const responseData = result.alipay_trade_query_response as Record<string, any>

    if (responseData.code !== '10000') {
      throw new Error(`Alipay query error: ${responseData.sub_msg || responseData.msg}`)
    }

    const tradeStatus = responseData.trade_status
    const status = tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED'
      ? 'success'
      : 'failed'

    return {
      providerOrderId: responseData.trade_no,
      orderId: responseData.out_trade_no,
      status,
      paidAmount: status === 'success' ? this.cnyToUsd(Number(responseData.total_amount)) : undefined,
      paidAt: status === 'success' ? new Date(responseData.send_pay_date).getTime() : undefined,
      rawData: responseData,
    }
  }

  private sign(params: Record<string, unknown>): string {
    const sortedParams = Object.keys(params)
      .sort()
      .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
      .map((key) => `${key}=${params[key]}`)
      .join('&')

    const sign = createSign('RSA-SHA256')
    sign.update(sortedParams, 'utf-8')
    return sign.sign(this.privateKey, 'base64')
  }

  private verify(params: Record<string, unknown>, signature: string): boolean {
    const sortedParams = Object.keys(params)
      .sort()
      .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
      .map((key) => `${key}=${params[key]}`)
      .join('&')

    const verify = createVerify('RSA-SHA256')
    verify.update(sortedParams, 'utf-8')
    return verify.verify(this.alipayPublicKey, signature, 'base64')
  }

  private formatDateTime(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }

  private usdToCny(usd: number): number {
    // 简化汇率转换，实际应该调用汇率 API
    return usd * 7.2
  }

  private cnyToUsd(cny: number): number {
    return cny / 7.2
  }
}
