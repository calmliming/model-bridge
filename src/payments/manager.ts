import { randomBytes } from 'node:crypto'
import { pool } from '../db/index'
import { applyWalletTransactionWithClient } from '../wallet/manager'
import { microsToUsd, usdToMicros } from '../wallet/money'
import { getPaymentProvider } from './providers/index'

const ORDER_TTL_MS = 30 * 60_000

export type PaymentOrderStatus = 'pending' | 'paid' | 'canceled' | 'expired'
export type PaymentProviderType = 'manual' | 'alipay' | 'wechat'

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
  walletTransactionId: string | null
  note: string | null
  expiresAt: number
  paidAt: number | null
  canceledAt: number | null
  createdAt: number
  updatedAt: number
}

function generateId(): string {
  return `po_${randomBytes(12).toString('hex')}`
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
    walletTransactionId: (row.wallet_transaction_id as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    expiresAt: Number(row.expires_at),
    paidAt: row.paid_at == null ? null : Number(row.paid_at),
    canceledAt: row.canceled_at == null ? null : Number(row.canceled_at),
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

  // 如果使用第三方支付，调用支付网关创建订单
  if (provider === 'alipay' || provider === 'wechat') {
    const paymentProvider = getPaymentProvider(provider)
    if (!paymentProvider) {
      throw new PaymentOrderError(`Payment provider ${provider} is not configured`, 400)
    }

    try {
      const result = await paymentProvider.createPayment({
        orderId: id,
        amount: input.amount,
        subject: 'Model Bridge 账户充值',
        body: `充值金额: $${input.amount.toFixed(2)}`,
        userId: input.userId,
      })

      providerOrderId = result.providerOrderId
      paymentUrl = result.paymentUrl
    } catch (err) {
      throw new PaymentOrderError(
        `Failed to create ${provider} payment: ${(err as Error).message}`,
        500,
      )
    }
  }

  const inserted = await pool.query<Record<string, unknown>>(
    `INSERT INTO payment_orders
       (id, user_id, provider, status, amount_micros, provider_order_id, payment_url, expires_at, created_at, updated_at)
     VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $8)
     RETURNING id, user_id, NULL::text AS user_email, NULL::text AS user_name,
               provider, status, amount_micros, provider_order_id, payment_url,
               wallet_transaction_id, note, expires_at, paid_at, canceled_at,
               created_at, updated_at`,
    [id, input.userId, provider, amountMicros, providerOrderId, paymentUrl, now + ORDER_TTL_MS, now],
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
              payment_url, wallet_transaction_id, note, expires_at, paid_at,
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
  const paymentProvider = getPaymentProvider(input.provider)
  if (!paymentProvider) {
    throw new PaymentOrderError(`Payment provider ${input.provider} is not configured`, 400)
  }

  // 验证并解析回调数据
  const notification = await paymentProvider.verifyNotification(input.data)

  if (notification.status !== 'success') {
    return { success: false }
  }

  // 查询订单
  const selected = await pool.query<Record<string, unknown>>(
    `SELECT id, user_id, provider, status, amount_micros, provider_order_id,
            payment_url, wallet_transaction_id, note, expires_at, paid_at,
            canceled_at, created_at, updated_at
     FROM payment_orders
     WHERE id = $1`,
    [notification.orderId],
  )

  const order = selected.rows[0]
  if (!order) {
    throw new PaymentOrderError('payment order not found', 404)
  }

  // 如果订单已经处理过，直接返回成功
  if (order.status === 'paid') {
    return { success: true, orderId: notification.orderId }
  }

  // 如果订单不是 pending 状态，不处理
  if (order.status !== 'pending') {
    throw new PaymentOrderError('payment order is not pending', 409)
  }

  // 确认入账
  const client = await pool.connect()
  let committed = false
  try {
    await client.query('BEGIN')

    const transaction = await applyWalletTransactionWithClient(client, {
      userId: order.user_id as string,
      type: 'credit',
      amountMicros: Number(order.amount_micros),
      note: `${input.provider} payment ${notification.providerOrderId}`,
      createdBy: input.provider,
    })

    await client.query(
      `UPDATE payment_orders
       SET status = 'paid',
           provider_order_id = $1,
           wallet_transaction_id = $2,
           paid_at = $3,
           updated_at = $3
       WHERE id = $4`,
      [notification.providerOrderId, transaction.id, notification.paidAt || Date.now(), notification.orderId],
    )

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
