/**
 * 支付提供商基础接口
 */

export interface PaymentConfig {
  /** 支付宝配置 */
  alipay?: {
    appId: string
    privateKey: string
    alipayPublicKey: string
    gatewayUrl?: string
    notifyUrl: string
    returnUrl: string
  }
  /** 微信支付配置 */
  wechat?: {
    appId: string
    mchId: string
    apiKey: string
    notifyUrl: string
  }
}

export interface CreatePaymentParams {
  orderId: string
  amount: number // USD
  subject: string
  body?: string
  userId: string
}

export interface CreatePaymentResult {
  providerOrderId: string
  paymentUrl: string
  qrCode?: string
  expiresAt: number
}

export interface PaymentNotification {
  providerOrderId: string
  orderId: string
  status: 'success' | 'failed'
  paidAmount?: number
  paidAt?: number
  rawData: Record<string, unknown>
}

export interface PaymentProvider {
  /**
   * 创建支付订单
   */
  createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult>

  /**
   * 验证并解析支付回调通知
   */
  verifyNotification(data: Record<string, unknown>): Promise<PaymentNotification>

  /**
   * 查询订单状态（可选）
   */
  queryOrder?(providerOrderId: string): Promise<PaymentNotification>
}
