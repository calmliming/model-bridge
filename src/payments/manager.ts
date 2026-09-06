import { createHash, randomBytes } from 'node:crypto'
import { pool } from '../db/index'
import { applyWalletTransactionWithClient } from '../wallet/manager'
import { microsToUsd, usdToMicros } from '../wallet/money'
import { getPaymentProvider } from './providers/index'

const ORDER_TTL_MS = 30 * 60_000
// Alipay/WeChat settle in CNY cents, so converting back to USD can differ by
// less than one tenth of a cent at the configured fixed exchange rate.
const CALLBACK_AMOUNT_TOLERANCE_MICROS = 1_000

export type PaymentOrderStatus = 'pending' | 'paid' | 'canceled' | 'expired'
export type PaymentProviderType = 'manual' | 'alipay' | 'alipay_web' | 'wechat'

export class PaymentOrderError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message)
  }
}

export interface PaymentOrderView {
  id: string
  userId: string
  userEmail: string | null
  userName: string | null
  provider: string
  status: PaymentOrderStatus
  amountMicros: number
  amount: number
  providerOrderId: string | null
  paymentUrl: string | null
  paymentHtml: string | null
  providerAmount: string | null
  providerCurrency: string | null
  tradeStatus: string | null
  refundedAmountMicros: number
  walletTransactionId: string | null
  note: string | null
  expiresAt: number
  paidAt: number | null
  canceledAt: number | null
  createdAt: number
  updatedAt: number
}

export interface PaymentRefundView {
  id: string
  paymentOrderId: string
  status: 'pending' | 'succeeded' | 'unknown' | 'failed'
  amountMicros: number
  amount: number
  providerAmount: string
  providerCurrency: string
  reason: string | null
  walletTransactionId: string | null
  createdAt: number
  updatedAt: number
}

function generateId(): string {
  return `po_${randomBytes(12).toString('hex')}`
}

function generateRefundId(): string {
  return `rf_${randomBytes(12).toString('hex')}`
}

function normalizeProviderAmount(value: unknown): string | null {
  const match = String(value ?? '').trim().match(/^(\d+)(?:\.(\d{1,2}))?$/)
  if (!match) return null
  return `${BigInt(match[1]!).toString()}.${(match[2] ?? '').padEnd(2, '0')}`
}

function providerMatchesOrder(callbackProvider: 'alipay' | 'wechat', orderProvider: unknown): boolean {
  if (callbackProvider === 'alipay') return orderProvider === 'alipay' || orderProvider === 'alipay_web'
  return orderProvider === 'wechat'
}

function safeNotificationData(data: Record<string, unknown>): Record<string, unknown> {
  const { sign: _sign, ...safe } = data
  return safe
}

function asPaymentOrder(row: Record<string, unknown>): PaymentOrderView {
  const amountMicros = Number(row.amount_micros)
  return {
    id: row.id as string,
    userId: row.user_id as string,
    userEmail: (row.user_email as string | null) ?? null,
    userName: (row.user_name as string | null) ?? null,
    provider: row.provider as string,
    status: row.status as PaymentOrderStatus,
    amountMicros,
    amount: microsToUsd(amountMicros),
    providerOrderId: (row.provider_order_id as string | null) ?? null,
    paymentUrl: (row.payment_url as string | null) ?? null,
    paymentHtml: (row.payment_html as string | null) ?? null,
    providerAmount: (row.provider_amount as string | null) ?? null,
    providerCurrency: (row.provider_currency as string | null) ?? null,
    tradeStatus: (row.trade_status as string | null) ?? null,
    refundedAmountMicros: Number(row.refunded_amount_micros ?? 0),
    walletTransactionId: (row.wallet_transaction_id as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    expiresAt: Number(row.expires_at),
    paidAt: row.paid_at == null ? null : Number(row.paid_at),
    canceledAt: row.canceled_at == null ? null : Number(row.canceled_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function asPaymentRefund(row: Record<string, unknown>): PaymentRefundView {
  const amountMicros = Number(row.amount_micros)
  return {
    id: row.id as string,
    paymentOrderId: row.payment_order_id as string,
    status: row.status as PaymentRefundView['status'],
    amountMicros,
    amount: microsToUsd(amountMicros),
    providerAmount: row.provider_amount as string,
    providerCurrency: row.provider_currency as string,
    reason: (row.reason as string | null) ?? null,
    walletTransactionId: (row.wallet_transaction_id as string | null) ?? null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

async function expirePendingOrders(): Promise<void> {
  const now = Date.now()
  await pool.query(
    `UPDATE payment_orders
     SET status = 'expired', updated_at = $1
     WHERE status = 'pending' AND expires_at < $1`,
    [now],
  )
}

export async function createPaymentOrder(input: {
  userId: string
  amount: number
  provider?: PaymentProviderType
}): Promise<PaymentOrderView> {
  const amountMicros = usdToMicros(input.amount)
  if (!Number.isSafeInteger(amountMicros) || amountMicros <= 0) {
    throw new PaymentOrderError('amount must be positive')
  }

  const provider = input.provider || 'manual'
  const now = Date.now()
  const id = generateId()

  let providerOrderId: string | null = null
  let paymentUrl: string | null = null
  let paymentHtml: string | null = null
  let providerAmount: string | null = null
  let providerCurrency: string | null = null

  // 如果使用第三方支付，调用支付网关创建订单
  if (provider === 'alipay' || provider === 'alipay_web' || provider === 'wechat') {
    const paymentProvider = getPaymentProvider(provider)
    if (!paymentProvider) {
      throw new PaymentOrderError(`Payment provider ${provider} is not configured`, 400)
    }

    try {
      const result = await paymentProvider.createPayment({
        orderId: id,
        amount: input.amount,
        amountMicros,
        subject: 'Model Bridge 账户充值',
        body: `充值金额: $${input.amount.toFixed(2)}`,
        userId: input.userId,
        mode: provider === 'alipay_web' ? 'web' : 'qr',
      })

      providerOrderId = result.providerOrderId
      paymentUrl = result.paymentUrl ?? null
      paymentHtml = result.paymentHtml ?? null
      providerAmount = result.providerAmount ?? null
      providerCurrency = result.providerCurrency ?? null
    } catch (err) {
      throw new PaymentOrderError(
        `Failed to create ${provider} payment: ${(err as Error).message}`,
        500,
      )
    }
  }

  const inserted = await pool.query<Record<string, unknown>>(
    `INSERT INTO payment_orders
       (id, user_id, provider, status, amount_micros, provider_order_id, payment_url,
        payment_html, provider_amount, provider_currency, expires_at, created_at, updated_at)
     VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9, $10, $11, $11)
     RETURNING id, user_id, NULL::text AS user_email, NULL::text AS user_name,
               provider, status, amount_micros, provider_order_id, payment_url,
               payment_html, provider_amount, provider_currency, trade_status,
               refunded_amount_micros,
               wallet_transaction_id, note, expires_at, paid_at, canceled_at,
               created_at, updated_at`,
    [
      id,
      input.userId,
      provider,
      amountMicros,
      providerOrderId,
      paymentUrl,
      paymentHtml,
      providerAmount,
      providerCurrency,
      now + ORDER_TTL_MS,
      now,
    ],
  )
  return asPaymentOrder(inserted.rows[0]!)
}

export async function listPaymentOrdersForUser(
  userId: string,
  page = 1,
  pageSize = 20,
): Promise<{ page: number; pageSize: number; total: number; orders: PaymentOrderView[] }> {
  await expirePendingOrders()
  const safePage = Math.max(1, Math.floor(Number.isFinite(page) ? page : 1))
  const safePageSize = Math.max(1, Math.min(100, Math.floor(Number.isFinite(pageSize) ? pageSize : 20)))
  const offset = (safePage - 1) * safePageSize
  const [total, rows] = await Promise.all([
    pool.query<Record<string, unknown>>('SELECT COUNT(*) AS total FROM payment_orders WHERE user_id = $1', [userId]),
    pool.query<Record<string, unknown>>(
      `SELECT id, user_id, NULL::text AS user_email, NULL::text AS user_name,
              provider, status, amount_micros, provider_order_id, payment_url,
              payment_html, provider_amount, provider_currency, trade_status,
              refunded_amount_micros,
              wallet_transaction_id, note, expires_at, paid_at, canceled_at,
              created_at, updated_at
       FROM payment_orders
       WHERE user_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [userId, safePageSize, offset],
    ),
  ])
  return {
    page: safePage,
    pageSize: safePageSize,
    total: Number(total.rows[0]?.total ?? 0),
    orders: rows.rows.map(asPaymentOrder),
  }
}

export async function listPaymentOrders(input: {
  page?: number
  pageSize?: number
  status?: PaymentOrderStatus
} = {}): Promise<{ page: number; pageSize: number; total: number; orders: PaymentOrderView[] }> {
  await expirePendingOrders()
  const safePage = Math.max(1, Math.floor(Number.isFinite(input.page) ? input.page! : 1))
  const safePageSize = Math.max(1, Math.min(100, Math.floor(Number.isFinite(input.pageSize) ? input.pageSize! : 20)))
  const offset = (safePage - 1) * safePageSize
  const where = input.status ? 'WHERE o.status = $1' : ''
  const values: unknown[] = input.status ? [input.status] : []
  const limitParam = values.length + 1
  const offsetParam = values.length + 2
  const [total, rows] = await Promise.all([
    pool.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS total FROM payment_orders o ${where}`,
      values,
    ),
    pool.query<Record<string, unknown>>(
      `SELECT o.id, o.user_id, u.email AS user_email, u.name AS user_name,
              o.provider, o.status, o.amount_micros, o.provider_order_id, o.payment_url,
              o.payment_html, o.provider_amount, o.provider_currency, o.trade_status,
              o.refunded_amount_micros,
              o.wallet_transaction_id, o.note, o.expires_at, o.paid_at, o.canceled_at,
              o.created_at, o.updated_at
       FROM payment_orders o
       LEFT JOIN users u ON u.id = o.user_id
       ${where}
       ORDER BY o.created_at DESC, o.id DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...values, safePageSize, offset],
    ),
  ])
  return {
    page: safePage,
    pageSize: safePageSize,
    total: Number(total.rows[0]?.total ?? 0),
    orders: rows.rows.map(asPaymentOrder),
  }
}

export async function confirmPaymentOrder(input: {
  id: string
  paidBy: string
  providerOrderId?: string | null
  note?: string | null
}): Promise<PaymentOrderView> {
  const client = await pool.connect()
  let committed = false
  try {
    await client.query('BEGIN')
    const selected = await client.query<Record<string, unknown>>(
      `SELECT id, user_id, provider, status, amount_micros, provider_order_id,
              payment_url, payment_html, provider_amount, provider_currency,
              trade_status, refunded_amount_micros, wallet_transaction_id, note, expires_at, paid_at,
              canceled_at, created_at, updated_at
       FROM payment_orders
       WHERE id = $1
       FOR UPDATE`,
      [input.id],
    )
    const order = selected.rows[0]
    if (!order) throw new PaymentOrderError('payment order not found', 404)
    if (order.status !== 'pending') {
      throw new PaymentOrderError('payment order is not pending', 409)
    }
    const now = Date.now()
    if (Number(order.expires_at) < now) {
      await client.query(
        `UPDATE payment_orders SET status = 'expired', updated_at = $1 WHERE id = $2`,
        [now, input.id],
      )
      await client.query('COMMIT')
      committed = true
      throw new PaymentOrderError('payment order expired', 409)
    }

    const transaction = await applyWalletTransactionWithClient(client, {
      userId: order.user_id as string,
      type: 'credit',
      amountMicros: Number(order.amount_micros),
      note: input.note?.trim() || `payment order ${input.id}`,
      createdBy: input.paidBy,
    })
    const updated = await client.query<Record<string, unknown>>(
      `UPDATE payment_orders
       SET status = 'paid',
           provider_order_id = COALESCE($1, provider_order_id),
           wallet_transaction_id = $2,
           note = COALESCE($3, note),
           paid_at = $4,
           updated_at = $4
       WHERE id = $5
       RETURNING id, user_id, NULL::text AS user_email, NULL::text AS user_name,
                 provider, status, amount_micros, provider_order_id, payment_url,
                 payment_html, provider_amount, provider_currency, trade_status,
                 refunded_amount_micros,
                 wallet_transaction_id, note, expires_at, paid_at, canceled_at,
                 created_at, updated_at`,
      [
        input.providerOrderId?.trim() || null,
        transaction.id,
        input.note?.trim() || null,
        now,
        input.id,
      ],
    )
    await client.query('COMMIT')
    committed = true
    return asPaymentOrder(updated.rows[0]!)
  } catch (err) {
    if (!committed) await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function cancelPaymentOrder(input: {
  id: string
  canceledBy: string
  note?: string | null
}): Promise<PaymentOrderView> {
  const now = Date.now()
  const updated = await pool.query<Record<string, unknown>>(
    `UPDATE payment_orders
     SET status = 'canceled',
         note = COALESCE($1, note),
         canceled_at = $2,
         updated_at = $2
     WHERE id = $3 AND status = 'pending'
     RETURNING id, user_id, NULL::text AS user_email, NULL::text AS user_name,
               provider, status, amount_micros, provider_order_id, payment_url,
               payment_html, provider_amount, provider_currency, trade_status,
               refunded_amount_micros,
               wallet_transaction_id, note, expires_at, paid_at, canceled_at,
               created_at, updated_at`,
    [input.note?.trim() || `canceled by ${input.canceledBy}`, now, input.id],
  )
  if (!updated.rows[0]) {
    throw new PaymentOrderError('pending payment order not found', 404)
  }
  return asPaymentOrder(updated.rows[0]!)
}

/**
 * 处理支付回调通知（支付宝/微信）
 */
export async function handlePaymentNotification(input: {
  provider: 'alipay' | 'wechat'
  data: Record<string, unknown>
}): Promise<{ success: boolean; orderId?: string }> {
  const paymentProvider = input.provider === 'alipay'
    ? getPaymentProvider('alipay_web') ?? getPaymentProvider('alipay')
    : getPaymentProvider('wechat')
  if (!paymentProvider) {
    throw new PaymentOrderError(`Payment provider ${input.provider} is not configured`, 400)
  }

  // 验证并解析回调数据
  const notification = await paymentProvider.verifyNotification(input.data)

  const client = await pool.connect()
  let committed = false
  try {
    await client.query('BEGIN')

    // Lock before checking status. Duplicate callbacks can arrive in parallel;
    // only the first transaction may credit the wallet.
    const selected = await client.query<Record<string, unknown>>(
      `SELECT id, user_id, provider, status, amount_micros, provider_order_id,
              payment_url, payment_html, provider_amount, provider_currency,
              trade_status, refunded_amount_micros, wallet_transaction_id, note, expires_at, paid_at,
              canceled_at, created_at, updated_at
       FROM payment_orders
       WHERE id = $1
       FOR UPDATE`,
      [notification.orderId],
    )
    const order = selected.rows[0]
    if (!order) {
      throw new PaymentOrderError('payment order not found', 404)
    }
    if (!providerMatchesOrder(input.provider, order.provider)) {
      throw new PaymentOrderError('payment provider does not match order', 409)
    }

    if (notification.status === 'success') {
      const expectedProviderAmount = normalizeProviderAmount(order.provider_amount)
      const paidProviderAmount = normalizeProviderAmount(notification.paidProviderAmount)
      if (order.provider === 'alipay_web') {
        if (!expectedProviderAmount || !paidProviderAmount || expectedProviderAmount !== paidProviderAmount) {
          throw new PaymentOrderError('payment provider amount does not match order', 409)
        }
      } else {
        if (notification.paidAmount == null || !Number.isFinite(notification.paidAmount)) {
          throw new PaymentOrderError('payment notification amount is missing', 400)
        }
        const paidAmountMicros = usdToMicros(notification.paidAmount)
        const orderAmountMicros = Number(order.amount_micros)
        if (Math.abs(paidAmountMicros - orderAmountMicros) > CALLBACK_AMOUNT_TOLERANCE_MICROS) {
          throw new PaymentOrderError('payment amount does not match order', 409)
        }
      }
    }

    const rawNotifyId = String(input.data.notify_id ?? '').trim()
    const replayKey = rawNotifyId ? `${input.provider}:${rawNotifyId}` : [
      input.provider,
      notification.orderId,
      notification.providerOrderId,
      notification.tradeStatus ?? notification.status,
    ].join(':')
    const eventId = `pn_${createHash('sha256').update(replayKey).digest('hex').slice(0, 32)}`
    const eventInsert = await client.query(
      `INSERT INTO payment_notification_events
         (id, provider, notify_id, out_trade_no, provider_order_id, trade_status, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (notify_id) DO NOTHING`,
      [
        eventId,
        input.provider,
        replayKey,
        notification.orderId,
        notification.providerOrderId || null,
        notification.tradeStatus ?? null,
        safeNotificationData(input.data),
      ],
    )
    if (eventInsert.rowCount === 0) {
      await client.query('COMMIT')
      committed = true
      return { success: true, orderId: notification.orderId }
    }

    if (notification.status !== 'success') {
      await client.query(
        `UPDATE payment_orders SET trade_status = $1, updated_at = $2 WHERE id = $3`,
        [notification.tradeStatus ?? null, Date.now(), notification.orderId],
      )
      await client.query('COMMIT')
      committed = true
      return { success: true, orderId: notification.orderId }
    }

    const orderAmountMicros = Number(order.amount_micros)

    // A matching replay is successful but must not produce another wallet row.
    if (order.status === 'paid') {
      if (
        order.provider_order_id &&
        notification.providerOrderId &&
        order.provider_order_id !== notification.providerOrderId
      ) {
        throw new PaymentOrderError('provider payment id does not match paid order', 409)
      }
      await client.query('COMMIT')
      committed = true
      return { success: true, orderId: notification.orderId }
    }
    if (order.status !== 'pending') {
      throw new PaymentOrderError('payment order is not pending', 409)
    }

    const transaction = await applyWalletTransactionWithClient(client, {
      userId: order.user_id as string,
      type: 'credit',
      amountMicros: orderAmountMicros,
      note: `${input.provider} payment ${notification.providerOrderId}`,
      createdBy: input.provider,
    })

    const paidAt = Number.isFinite(notification.paidAt) ? notification.paidAt! : Date.now()

    const updated = await client.query(
      `UPDATE payment_orders
       SET status = 'paid',
           provider_order_id = $1,
           wallet_transaction_id = $2,
           trade_status = $3,
           paid_at = $4,
           updated_at = $4
       WHERE id = $5 AND status = 'pending'`,
      [
        notification.providerOrderId,
        transaction.id,
        notification.tradeStatus ?? 'TRADE_SUCCESS',
        paidAt,
        notification.orderId,
      ],
    )
    if (updated.rowCount !== 1) {
      throw new PaymentOrderError('payment order state changed', 409)
    }

    await client.query('COMMIT')
    committed = true
    return { success: true, orderId: notification.orderId }
  } catch (err) {
    if (!committed) await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

async function selectPaymentOrder(id: string, userId?: string): Promise<Record<string, unknown>> {
  const result = await pool.query<Record<string, unknown>>(
    `SELECT id, user_id, provider, status, amount_micros, provider_order_id,
            payment_url, payment_html, provider_amount, provider_currency,
            trade_status, refunded_amount_micros, wallet_transaction_id, note,
            expires_at, paid_at, canceled_at, created_at, updated_at
     FROM payment_orders
     WHERE id = $1${userId ? ' AND user_id = $2' : ''}`,
    userId ? [id, userId] : [id],
  )
  const order = result.rows[0]
  if (!order) throw new PaymentOrderError('payment order not found', 404)
  return order
}

function providerForOrder(order: Record<string, unknown>) {
  const provider = order.provider as PaymentProviderType
  if (provider !== 'alipay' && provider !== 'alipay_web' && provider !== 'wechat') {
    throw new PaymentOrderError('payment order does not use an online provider', 400)
  }
  const paymentProvider = getPaymentProvider(provider)
  if (!paymentProvider) throw new PaymentOrderError(`Payment provider ${provider} is not configured`, 400)
  return paymentProvider
}

function assertProviderAmountMatches(order: Record<string, unknown>, notification: {
  paidAmount?: number
  paidProviderAmount?: string
}): void {
  const expectedProviderAmount = normalizeProviderAmount(order.provider_amount)
  const paidProviderAmount = normalizeProviderAmount(notification.paidProviderAmount)
  if (order.provider === 'alipay_web') {
    if (!expectedProviderAmount || !paidProviderAmount || expectedProviderAmount !== paidProviderAmount) {
      throw new PaymentOrderError('payment provider amount does not match order', 409)
    }
    return
  }
  if (notification.paidAmount == null || !Number.isFinite(notification.paidAmount)) {
    throw new PaymentOrderError('payment amount is missing', 400)
  }
  if (
    Math.abs(usdToMicros(notification.paidAmount) - Number(order.amount_micros)) >
    CALLBACK_AMOUNT_TOLERANCE_MICROS
  ) {
    throw new PaymentOrderError('payment amount does not match order', 409)
  }
}

async function reconcileQueriedPayment(
  orderId: string,
  notification: Awaited<ReturnType<NonNullable<ReturnType<typeof providerForOrder>['queryOrder']>>>,
): Promise<PaymentOrderView> {
  const client = await pool.connect()
  let committed = false
  try {
    await client.query('BEGIN')
    const selected = await client.query<Record<string, unknown>>(
      `SELECT id, user_id, provider, status, amount_micros, provider_order_id,
              payment_url, payment_html, provider_amount, provider_currency,
              trade_status, refunded_amount_micros, wallet_transaction_id, note,
              expires_at, paid_at, canceled_at, created_at, updated_at
       FROM payment_orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    )
    const order = selected.rows[0]
    if (!order) throw new PaymentOrderError('payment order not found', 404)

    if (notification.status !== 'success') {
      const closed = notification.tradeStatus === 'TRADE_CLOSED'
      const updated = await client.query<Record<string, unknown>>(
        `UPDATE payment_orders
         SET trade_status = $1,
             status = CASE WHEN $2 AND status = 'pending' THEN 'canceled' ELSE status END,
             canceled_at = CASE WHEN $2 AND status = 'pending' THEN $3 ELSE canceled_at END,
             updated_at = $3
         WHERE id = $4
         RETURNING id, user_id, NULL::text AS user_email, NULL::text AS user_name,
                   provider, status, amount_micros, provider_order_id, payment_url,
                   payment_html, provider_amount, provider_currency, trade_status,
                   refunded_amount_micros, wallet_transaction_id, note, expires_at,
                   paid_at, canceled_at, created_at, updated_at`,
        [notification.tradeStatus ?? null, closed, Date.now(), orderId],
      )
      await client.query('COMMIT')
      committed = true
      return asPaymentOrder(updated.rows[0]!)
    }

    assertProviderAmountMatches(order, notification)
    if (order.status === 'paid') {
      await client.query('COMMIT')
      committed = true
      return asPaymentOrder({ ...order, user_email: null, user_name: null })
    }
    if (order.status !== 'pending') throw new PaymentOrderError('payment order is not pending', 409)

    const transaction = await applyWalletTransactionWithClient(client, {
      userId: order.user_id as string,
      type: 'credit',
      amountMicros: Number(order.amount_micros),
      note: `payment query confirmed ${notification.providerOrderId}`,
      createdBy: 'payment-query',
    })
    const now = Number.isFinite(notification.paidAt) ? notification.paidAt! : Date.now()
    const updated = await client.query<Record<string, unknown>>(
      `UPDATE payment_orders
       SET status = 'paid', provider_order_id = $1, wallet_transaction_id = $2,
           trade_status = $3, paid_at = $4, updated_at = $4
       WHERE id = $5 AND status = 'pending'
       RETURNING id, user_id, NULL::text AS user_email, NULL::text AS user_name,
                 provider, status, amount_micros, provider_order_id, payment_url,
                 payment_html, provider_amount, provider_currency, trade_status,
                 refunded_amount_micros, wallet_transaction_id, note, expires_at,
                 paid_at, canceled_at, created_at, updated_at`,
      [
        notification.providerOrderId,
        transaction.id,
        notification.tradeStatus ?? 'TRADE_SUCCESS',
        now,
        orderId,
      ],
    )
    if (updated.rowCount !== 1) throw new PaymentOrderError('payment order state changed', 409)
    await client.query('COMMIT')
    committed = true
    return asPaymentOrder(updated.rows[0]!)
  } catch (error) {
    if (!committed) await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

/** Query the provider and reconcile a user's own order without trusting return parameters. */
export async function queryPaymentOrder(input: {
  id: string
  userId?: string
}): Promise<PaymentOrderView> {
  const order = await selectPaymentOrder(input.id, input.userId)
  const provider = providerForOrder(order)
  if (!provider.queryOrder) throw new PaymentOrderError('payment provider does not support queries', 400)
  const notification = await provider.queryOrder(input.id)
  return reconcileQueriedPayment(input.id, notification)
}

/** Close an unpaid provider order and persist the local terminal state. */
export async function closeOnlinePaymentOrder(input: {
  id: string
  closedBy: string
}): Promise<PaymentOrderView> {
  const order = await selectPaymentOrder(input.id)
  if (order.status !== 'pending') throw new PaymentOrderError('payment order is not pending', 409)
  const provider = providerForOrder(order)
  if (!provider.closeOrder) throw new PaymentOrderError('payment provider does not support close', 400)
  await provider.closeOrder(input.id, (order.provider_order_id as string | null) ?? null)
  const now = Date.now()
  const updated = await pool.query<Record<string, unknown>>(
    `UPDATE payment_orders
     SET status = 'canceled', trade_status = 'TRADE_CLOSED', canceled_at = $1,
         updated_at = $1, note = COALESCE(note, $2)
     WHERE id = $3 AND status = 'pending'
     RETURNING id, user_id, NULL::text AS user_email, NULL::text AS user_name,
               provider, status, amount_micros, provider_order_id, payment_url,
               payment_html, provider_amount, provider_currency, trade_status,
               refunded_amount_micros, wallet_transaction_id, note, expires_at,
               paid_at, canceled_at, created_at, updated_at`,
    [now, `closed by ${input.closedBy}`, input.id],
  )
  if (!updated.rows[0]) throw new PaymentOrderError('payment order state changed', 409)
  return asPaymentOrder(updated.rows[0])
}

function prorateProviderAmount(order: Record<string, unknown>, refundMicros: number): string {
  const total = normalizeProviderAmount(order.provider_amount)
  if (!total) throw new PaymentOrderError('payment order is missing provider settlement amount', 409)
  const [whole, fraction] = total.split('.')
  const totalCents = BigInt(whole!) * 100n + BigInt(fraction!)
  const orderMicros = BigInt(Number(order.amount_micros))
  const cents = (totalCents * BigInt(refundMicros) + orderMicros / 2n) / orderMicros
  if (cents < 1n) throw new PaymentOrderError('refund amount converts to less than CNY 0.01', 400)
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`
}

async function finalizeRefund(outRequestNo: string, providerResponse: Record<string, unknown>): Promise<PaymentRefundView> {
  const client = await pool.connect()
  let committed = false
  try {
    await client.query('BEGIN')
    const selected = await client.query<Record<string, unknown>>(
      `SELECT r.id, r.payment_order_id, r.status, r.amount_micros, r.provider_amount,
              r.provider_currency, r.reason, r.wallet_transaction_id, r.created_at,
              r.updated_at, o.user_id
       FROM payment_refunds r
       JOIN payment_orders o ON o.id = r.payment_order_id
       WHERE r.id = $1 FOR UPDATE`,
      [outRequestNo],
    )
    const refund = selected.rows[0]
    if (!refund) throw new PaymentOrderError('payment refund not found', 404)
    if (refund.status === 'succeeded' && refund.wallet_transaction_id) {
      await client.query('COMMIT')
      committed = true
      return asPaymentRefund(refund)
    }
    const transaction = await applyWalletTransactionWithClient(client, {
      userId: refund.user_id as string,
      type: 'debit',
      amountMicros: -Number(refund.amount_micros),
      note: `Alipay refund ${outRequestNo}`,
      createdBy: 'alipay-refund',
    })
    const now = Date.now()
    const updated = await client.query<Record<string, unknown>>(
      `UPDATE payment_refunds
       SET status = 'succeeded', wallet_transaction_id = $1,
           provider_response = $2, updated_at = $3
       WHERE id = $4
       RETURNING id, payment_order_id, status, amount_micros, provider_amount,
                 provider_currency, reason, wallet_transaction_id, created_at, updated_at`,
      [transaction.id, providerResponse, now, outRequestNo],
    )
    await client.query(
      `UPDATE payment_orders
       SET refunded_amount_micros = refunded_amount_micros + $1, updated_at = $2
       WHERE id = $3`,
      [Number(refund.amount_micros), now, refund.payment_order_id],
    )
    await client.query('COMMIT')
    committed = true
    return asPaymentRefund(updated.rows[0]!)
  } catch (error) {
    if (!committed) await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

/** Create or retry one idempotent partial/full refund. */
export async function refundPaymentOrder(input: {
  id: string
  amount: number
  reason?: string
  outRequestNo?: string
}): Promise<PaymentRefundView> {
  const amountMicros = usdToMicros(input.amount)
  if (!Number.isSafeInteger(amountMicros) || amountMicros <= 0) {
    throw new PaymentOrderError('refund amount must be positive', 400)
  }
  const outRequestNo = input.outRequestNo?.trim() || generateRefundId()
  const client = await pool.connect()
  let committed = false
  let refund: PaymentRefundView
  let order: Record<string, unknown>
  try {
    await client.query('BEGIN')
    const selected = await client.query<Record<string, unknown>>(
      `SELECT id, user_id, provider, status, amount_micros, provider_order_id,
              provider_amount, provider_currency, refunded_amount_micros
       FROM payment_orders WHERE id = $1 FOR UPDATE`,
      [input.id],
    )
    order = selected.rows[0]!
    if (!order) throw new PaymentOrderError('payment order not found', 404)
    if (order.provider !== 'alipay_web') throw new PaymentOrderError('refund is only enabled for Alipay web orders', 400)
    if (order.status !== 'paid') throw new PaymentOrderError('only paid orders can be refunded', 409)

    const existing = await client.query<Record<string, unknown>>(
      `SELECT id, payment_order_id, status, amount_micros, provider_amount,
              provider_currency, reason, wallet_transaction_id, created_at, updated_at
       FROM payment_refunds WHERE id = $1`,
      [outRequestNo],
    )
    if (existing.rows[0]) {
      refund = asPaymentRefund(existing.rows[0])
      if (refund.paymentOrderId !== input.id || refund.amountMicros !== amountMicros) {
        throw new PaymentOrderError('outRequestNo belongs to different refund parameters', 409)
      }
      if (refund.status === 'succeeded') {
        await client.query('COMMIT')
        committed = true
        return refund
      }
    } else {
      const reserved = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount_micros), 0)::text AS total
         FROM payment_refunds
         WHERE payment_order_id = $1 AND status IN ('pending', 'unknown', 'succeeded')`,
        [input.id],
      )
      if (Number(reserved.rows[0]?.total ?? 0) + amountMicros > Number(order.amount_micros)) {
        throw new PaymentOrderError('cumulative refund exceeds paid order amount', 409)
      }
      const providerAmount = prorateProviderAmount(order, amountMicros)
      const inserted = await client.query<Record<string, unknown>>(
        `INSERT INTO payment_refunds
           (id, payment_order_id, status, amount_micros, provider_amount,
            provider_currency, reason, created_at, updated_at)
         VALUES ($1, $2, 'pending', $3, $4, 'CNY', $5, $6, $6)
         RETURNING id, payment_order_id, status, amount_micros, provider_amount,
                   provider_currency, reason, wallet_transaction_id, created_at, updated_at`,
        [outRequestNo, input.id, amountMicros, providerAmount, input.reason?.trim() || null, Date.now()],
      )
      refund = asPaymentRefund(inserted.rows[0]!)
    }
    await client.query('COMMIT')
    committed = true
  } catch (error) {
    if (!committed) await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }

  const provider = providerForOrder(order!)
  if (!provider.refund) throw new PaymentOrderError('payment provider does not support refunds', 400)
  try {
    const result = await provider.refund({
      orderId: input.id,
      providerOrderId: (order!.provider_order_id as string | null) ?? null,
      outRequestNo,
      providerAmount: refund!.providerAmount,
      reason: refund!.reason ?? undefined,
    })
    if (
      result.providerAmount &&
      normalizeProviderAmount(result.providerAmount) !== normalizeProviderAmount(refund!.providerAmount)
    ) {
      throw new PaymentOrderError('Alipay refund amount does not match the request', 409)
    }
    if (result.status === 'succeeded') return finalizeRefund(outRequestNo, result.rawData)
    const updated = await pool.query<Record<string, unknown>>(
      `UPDATE payment_refunds SET status = 'unknown', provider_response = $1, updated_at = $2
       WHERE id = $3
       RETURNING id, payment_order_id, status, amount_micros, provider_amount,
                 provider_currency, reason, wallet_transaction_id, created_at, updated_at`,
      [result.rawData, Date.now(), outRequestNo],
    )
    return asPaymentRefund(updated.rows[0]!)
  } catch (error) {
    await pool.query(
      `UPDATE payment_refunds SET status = 'unknown', updated_at = $1 WHERE id = $2`,
      [Date.now(), outRequestNo],
    )
    if (error instanceof PaymentOrderError) throw error
    throw new PaymentOrderError(`Alipay refund result is unknown: ${(error as Error).message}`, 502)
  }
}

/** Query a refund after the provider's recommended minimum delay. */
export async function queryPaymentRefund(input: {
  id: string
  outRequestNo: string
}): Promise<PaymentRefundView> {
  const selected = await pool.query<Record<string, unknown>>(
    `SELECT r.id, r.payment_order_id, r.status, r.amount_micros, r.provider_amount,
            r.provider_currency, r.reason, r.wallet_transaction_id, r.created_at,
            r.updated_at, o.provider, o.provider_order_id
     FROM payment_refunds r
     JOIN payment_orders o ON o.id = r.payment_order_id
     WHERE r.id = $1 AND r.payment_order_id = $2`,
    [input.outRequestNo, input.id],
  )
  const row = selected.rows[0]
  if (!row) throw new PaymentOrderError('payment refund not found', 404)
  const refund = asPaymentRefund(row)
  if (refund.status === 'succeeded') return refund
  if (Date.now() - refund.createdAt < 10_000) {
    throw new PaymentOrderError('wait at least 10 seconds before querying a refund', 409)
  }
  const provider = providerForOrder(row)
  if (!provider.queryRefund) throw new PaymentOrderError('payment provider does not support refund queries', 400)
  const result = await provider.queryRefund({
    orderId: input.id,
    providerOrderId: (row.provider_order_id as string | null) ?? null,
    outRequestNo: input.outRequestNo,
    providerAmount: refund.providerAmount,
    reason: refund.reason ?? undefined,
  })
  if (
    result.providerAmount &&
    normalizeProviderAmount(result.providerAmount) !== normalizeProviderAmount(refund.providerAmount)
  ) {
    throw new PaymentOrderError('Alipay refund query amount does not match the request', 409)
  }
  if (result.status === 'succeeded') return finalizeRefund(input.outRequestNo, result.rawData)
  const updated = await pool.query<Record<string, unknown>>(
    `UPDATE payment_refunds SET status = $1, provider_response = $2, updated_at = $3
     WHERE id = $4
     RETURNING id, payment_order_id, status, amount_micros, provider_amount,
               provider_currency, reason, wallet_transaction_id, created_at, updated_at`,
    [result.status, result.rawData, Date.now(), input.outRequestNo],
  )
  return asPaymentRefund(updated.rows[0]!)
}
