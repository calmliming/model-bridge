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
    notifyUrl?: string
    returnUrl?: string
    sellerId?: string
    sellerEmail?: string
    usdCnyRate: string
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
  amountMicros: number
  subject: string
  body?: string
  userId: string
  mode?: 'qr' | 'web'
}

export interface CreatePaymentResult {
  providerOrderId: string
  paymentUrl?: string
  paymentHtml?: string
  qrCode?: string
  providerAmount?: string
  providerCurrency?: 'CNY'
  expiresAt: number
}

export interface PaymentNotification {
  providerOrderId: string
  orderId: string
  status: 'success' | 'ignored' | 'failed'
  paidAmount?: number
  paidProviderAmount?: string
  paidAt?: number
  tradeStatus?: string
  rawData: Record<string, unknown>
}

export interface RefundPaymentParams {
  orderId: string
  providerOrderId?: string | null
  outRequestNo: string
  providerAmount: string
  reason?: string
}

export interface RefundPaymentResult {
  outRequestNo: string
  providerOrderId?: string
  status: 'succeeded' | 'unknown'
  providerAmount?: string
  rawData: Record<string, unknown>
}

export interface RefundQueryResult {
  outRequestNo: string
  status: 'succeeded' | 'pending' | 'unknown'
  providerAmount?: string
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

  /** Refund a paid order. */
  refund?(params: RefundPaymentParams): Promise<RefundPaymentResult>

  /** Query a refund using the original request number. */
  queryRefund?(params: RefundPaymentParams): Promise<RefundQueryResult>

  /** Close an unpaid order. */
  closeOrder?(orderId: string, providerOrderId?: string | null): Promise<Record<string, unknown>>

  /** Verify synchronous return parameters before using their order reference. */
  verifyReturn?(data: Record<string, unknown>): boolean
}
