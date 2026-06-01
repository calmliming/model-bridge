import { createHash, createSign } from 'node:crypto'
import type {
  CreatePaymentParams,
  CreatePaymentResult,
  PaymentNotification,
  PaymentProvider,
} from './base'

/**
 * 微信支付提供商
 * 使用 Native 支付（扫码支付）API
 */
export class WechatPayProvider implements PaymentProvider {
  private readonly appId: string
  private readonly mchId: string
  private readonly apiKey: string
  private readonly notifyUrl: string
  private readonly apiUrl = 'https://api.mch.weixin.qq.com'

  constructor(config: {
    appId: string
    mchId: string
    apiKey: string
    notifyUrl: string
  }) {
    this.appId = config.appId
    this.mchId = config.mchId
    this.apiKey = config.apiKey
    this.notifyUrl = config.notifyUrl
  }

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    const amountCny = this.usdToCny(params.amount)
    const totalFee = Math.round(amountCny * 100) // 转换为分

    const requestData = {
      appid: this.appId,
      mch_id: this.mchId,
      nonce_str: this.generateNonce(),
      body: params.subject,
      out_trade_no: params.orderId,
      total_fee: totalFee.toString(),
      spbill_create_ip: '127.0.0.1',
      notify_url: this.notifyUrl,
      trade_type: 'NATIVE',
      product_id: params.orderId,
    }

    const sign = this.sign(requestData)
    const xml = this.buildXml({ ...requestData, sign })

    const response = await fetch(`${this.apiUrl}/pay/unifiedorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml' },
      body: xml,
    })

    const responseText = await response.text()
    const result = this.parseXml(responseText)

    if (result.return_code !== 'SUCCESS') {
      throw new Error(`WeChat Pay error: ${result.return_msg}`)
    }

    if (result.result_code !== 'SUCCESS') {
      throw new Error(`WeChat Pay error: ${result.err_code_des || result.err_code}`)
    }

    // 验证返回签名
    if (!this.verifySign(result)) {
      throw new Error('WeChat Pay signature verification failed')
    }

    return {
      providerOrderId: result.prepay_id,
      paymentUrl: result.code_url,
      qrCode: result.code_url,
      expiresAt: Date.now() + 30 * 60_000,
    }
  }

  async verifyNotification(data: Record<string, unknown>): Promise<PaymentNotification> {
    // 验证签名
    if (!this.verifySign(data)) {
      throw new Error('WeChat Pay signature verification failed')
    }

    if (data.return_code !== 'SUCCESS') {
      throw new Error(`WeChat Pay notification error: ${data.return_msg}`)
    }

    const status = data.result_code === 'SUCCESS' ? 'success' : 'failed'
    const totalFee = Number(data.total_fee) / 100 // 分转元

    return {
      providerOrderId: data.transaction_id as string,
      orderId: data.out_trade_no as string,
      status,
      paidAmount: status === 'success' ? this.cnyToUsd(totalFee) : undefined,
      paidAt: status === 'success' ? this.parseWechatTime(data.time_end as string) : undefined,
      rawData: data,
    }
  }

  async queryOrder(outTradeNo: string): Promise<PaymentNotification> {
    const requestData = {
      appid: this.appId,
      mch_id: this.mchId,
      out_trade_no: outTradeNo,
      nonce_str: this.generateNonce(),
    }

    const sign = this.sign(requestData)
    const xml = this.buildXml({ ...requestData, sign })

    const response = await fetch(`${this.apiUrl}/pay/orderquery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml' },
      body: xml,
    })

    const responseText = await response.text()
    const result = this.parseXml(responseText)

    if (result.return_code !== 'SUCCESS') {
      throw new Error(`WeChat Pay query error: ${result.return_msg}`)
    }

    if (result.result_code !== 'SUCCESS') {
      throw new Error(`WeChat Pay query error: ${result.err_code_des || result.err_code}`)
    }

    const status = result.trade_state === 'SUCCESS' ? 'success' : 'failed'
    const totalFee = Number(result.total_fee) / 100

    return {
      providerOrderId: result.transaction_id,
      orderId: result.out_trade_no,
      status,
      paidAmount: status === 'success' ? this.cnyToUsd(totalFee) : undefined,
      paidAt: status === 'success' ? this.parseWechatTime(result.time_end) : undefined,
      rawData: result,
    }
  }

  private sign(params: Record<string, unknown>): string {
    const sortedParams = Object.keys(params)
      .sort()
      .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
      .map((key) => `${key}=${params[key]}`)
      .join('&')

    const stringSignTemp = `${sortedParams}&key=${this.apiKey}`
    return createHash('md5').update(stringSignTemp, 'utf-8').digest('hex').toUpperCase()
  }

  private verifySign(data: Record<string, unknown>): boolean {
    const receivedSign = data.sign as string
    const params = { ...data }
    delete params.sign

    const calculatedSign = this.sign(params)
    return receivedSign === calculatedSign
  }

  private buildXml(data: Record<string, unknown>): string {
    const entries = Object.entries(data)
      .map(([key, value]) => `<${key}><![CDATA[${value}]]></${key}>`)
      .join('')
    return `<xml>${entries}</xml>`
  }

  private parseXml(xml: string): Record<string, string> {
    const result: Record<string, string> = {}
    const regex = /<(\w+)>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/\1>/g
    let match

    while ((match = regex.exec(xml)) !== null) {
      result[match[1]!] = match[2]!
    }

    return result
  }

  private generateNonce(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
  }

  private parseWechatTime(timeStr: string): number {
    // 微信时间格式：yyyyMMddHHmmss
    const year = Number.parseInt(timeStr.substring(0, 4), 10)
    const month = Number.parseInt(timeStr.substring(4, 6), 10) - 1
    const day = Number.parseInt(timeStr.substring(6, 8), 10)
    const hour = Number.parseInt(timeStr.substring(8, 10), 10)
    const minute = Number.parseInt(timeStr.substring(10, 12), 10)
    const second = Number.parseInt(timeStr.substring(12, 14), 10)
    return new Date(year, month, day, hour, minute, second).getTime()
  }

  private usdToCny(usd: number): number {
    // 简化汇率转换，实际应该调用汇率 API
    return usd * 7.2
  }

  private cnyToUsd(cny: number): number {
    return cny / 7.2
  }
}
