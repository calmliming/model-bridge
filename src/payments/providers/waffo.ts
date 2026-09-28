import { createHash, sign, verify } from 'node:crypto'
import { z } from 'zod'
import { config } from '../../config'
import { fetchWithConnectTimeout } from '../../http/upstream'
import { SubscriptionError } from '../../subscriptions/manager'

const CHECKOUT_PATH = '/v1/actions/checkout/create-session'
const normalizePem = (value: string) => value.replace(/\\n/g, '\n')

export function waffoConfiguration() {
  const missing = (['WAFFO_MERCHANT_ID', 'WAFFO_STORE_ID', 'WAFFO_PRIVATE_KEY', 'WAFFO_WEBHOOK_PUBLIC_KEY'] as const)
    .filter(key => !config[key]?.trim())
  return { configured: missing.length === 0, mode: config.WAFFO_MODE, missing }
}

export function signWaffoRequest(body: string, privateKey: string, timestamp: string): string {
  const digest = createHash('sha256').update(body).digest('base64')
  const canonical = `POST\n${CHECKOUT_PATH}\n${timestamp}\n${digest}`
  return sign('RSA-SHA256', Buffer.from(canonical), normalizePem(privateKey)).toString('base64')
}

export function safeWaffoCheckoutUrl(value: string, mode: 'test' | 'prod'): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || !['checkout.waffo.ai', 'pancake.waffo.ai'].includes(url.hostname)) {
    throw new SubscriptionError('Waffo 返回了无效的收银台地址', 502)
  }
  if (mode === 'test') url.searchParams.set('test', 'true')
  return url.toString()
}

/** Official REST API: https://docs.waffo.ai/api-reference/endpoints/orders/create-checkout-session */
export async function createWaffoSession(input: {
  checkoutId: string; planId: string; productId: string; price: number; email: string
}) {
  if (!waffoConfiguration().configured) throw new SubscriptionError('订阅支付尚未配置，请联系管理员', 503)
  const body = JSON.stringify({
    productId: input.productId,
    currency: 'USD',
    buyerEmail: input.email,
    language: 'zh-Hans',
    withTrial: false,
    expiresInSeconds: 1800,
    priceSnapshot: { amount: input.price.toFixed(2), taxIncluded: false, taxCategory: 'saas' },
    orderMerchantExternalId: input.checkoutId,
    metadata: { checkoutId: input.checkoutId, planId: input.planId, productId: input.productId },
    ...(config.WAFFO_SUCCESS_URL ? { successUrl: config.WAFFO_SUCCESS_URL } : {}),
  })
  const timestamp = Math.floor(Date.now() / 1000).toString()
  let response: Response
  try {
    response = await fetchWithConnectTimeout(`https://api.waffo.ai${CHECKOUT_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Merchant-Id': config.WAFFO_MERCHANT_ID!,
        'X-Timestamp': timestamp,
        'X-Signature': signWaffoRequest(body, config.WAFFO_PRIVATE_KEY!, timestamp),
      },
      body,
    }, 15_000)
  } catch {
    throw new SubscriptionError('暂时无法连接 Waffo，请稍后重试', 502)
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new SubscriptionError(`Waffo 下单失败（${response.status}），请检查商户和产品配置`, 502)
  }
  const result = z.object({ data: z.object({
    sessionId: z.string().min(1), checkoutUrl: z.string().url(), expiresAt: z.string().datetime(),
  }) }).safeParse(await response.json())
  if (!result.success || Date.parse(result.data.data.expiresAt) <= Date.now()) {
    throw new SubscriptionError('Waffo 返回了无效的支付会话', 502)
  }
  return { ...result.data.data, checkoutUrl: safeWaffoCheckoutUrl(result.data.data.checkoutUrl, config.WAFFO_MODE) }
}

const eventSchema = z.object({
  id: z.string().min(1), eventId: z.string().min(1), eventType: z.string().min(1),
  timestamp: z.string().datetime(), storeId: z.string().min(1), mode: z.enum(['test', 'prod']),
  data: z.object({
    orderId: z.string().min(1), orderMerchantExternalId: z.string().optional(),
    orderMetadata: z.record(z.unknown()).optional(), currency: z.string(),
    orderStatus: z.string().optional(), billingPeriod: z.string().optional(),
    currentPeriodStart: z.string().optional(), currentPeriodEnd: z.string().optional(),
    subtotal: z.string().optional(), amount: z.string().optional(), taxAmount: z.string().optional(),
    planPrice: z.object({ subtotal: z.string().optional() }).passthrough().optional(),
  }).passthrough(),
}).passthrough()

export type WaffoEvent = z.infer<typeof eventSchema>

/** Verify the exact raw body, pin the environment/store, and accept legitimate 31-minute retries. */
export function verifyWaffoEvent(rawBody: string, header: string | undefined, now = Date.now()): WaffoEvent {
  if (!waffoConfiguration().configured) throw new SubscriptionError('Waffo 尚未配置', 503)
  const parts = Object.fromEntries((header ?? '').split(',').map(pair => {
    const i = pair.indexOf('=')
    return [pair.slice(0, i).trim(), pair.slice(i + 1).trim()]
  }))
  const timestamp = Number(parts.t)
  if (!parts.v1 || !/^\d+$/.test(parts.t ?? '') || !Number.isSafeInteger(timestamp)
    || Math.abs(now - timestamp) > 45 * 60_000) {
    throw new SubscriptionError('无效的 Waffo 通知签名', 401)
  }
  let verified = false
  try {
    verified = verify('RSA-SHA256', Buffer.from(`${parts.t}.${rawBody}`),
      normalizePem(config.WAFFO_WEBHOOK_PUBLIC_KEY!), Buffer.from(parts.v1, 'base64'))
  } catch { /* Invalid keys and signatures fail closed. */ }
  if (!verified) throw new SubscriptionError('无效的 Waffo 通知签名', 401)
  let value: unknown
  try { value = JSON.parse(rawBody) } catch { throw new SubscriptionError('无效的 Waffo 通知内容', 400) }
  const event = eventSchema.safeParse(value)
  if (!event.success) throw new SubscriptionError('无效的 Waffo 通知内容', 400)
  if (event.data.mode !== config.WAFFO_MODE || event.data.storeId !== config.WAFFO_STORE_ID) {
    throw new SubscriptionError('Waffo 通知的环境或商店不匹配', 400)
  }
  return event.data
}
