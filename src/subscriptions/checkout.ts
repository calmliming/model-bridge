import { randomBytes } from 'node:crypto'
import { pool } from '../db/index'
import { config } from '../config'
import { isOnlinePaymentEnabled } from '../db/settings'
import { createWaffoSession, waffoConfiguration, type WaffoEvent } from '../payments/providers/waffo'
import { SubscriptionError } from './manager'

interface CheckoutRow {
  id: string; user_id: string; plan_id: string; group_id: string; product_id: string;
  store_id: string; mode: string; price: number | string; status: string;
  checkout_url: string | null; expires_at: number | string; provider_order_id: string | null;
  subscription_id: string | null; event_at: number | string;
}

function checkoutView(row: CheckoutRow) {
  return {
    id: row.id, status: row.status === 'pending' && Number(row.expires_at) <= Date.now() ? 'expired' : row.status,
    checkoutUrl: row.checkout_url, expiresAt: Number(row.expires_at), subscriptionId: row.subscription_id,
  }
}

export async function createSubscriptionCheckout(user: { id: string; email: string }, planId: string) {
  if (!(await isOnlinePaymentEnabled())) throw new SubscriptionError('在线支付暂未开放', 403)
  if (!waffoConfiguration().configured) throw new SubscriptionError('订阅支付尚未配置，请联系管理员', 503)
  const client = await pool.connect()
  let order: CheckoutRow
  try {
    await client.query('BEGIN')
    // Serializes checkout creation across every plan for this user.
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id])
    const { rows } = await client.query(
      `SELECT p.*, EXISTS(SELECT 1 FROM account_group_members m WHERE m.group_id = p.group_id) AS has_accounts
       FROM subscription_plans p WHERE p.id = $1 AND p.for_sale = TRUE FOR UPDATE OF p`, [planId],
    )
    const plan = rows[0]
    if (!plan || plan.payment_provider !== 'waffo') throw new SubscriptionError('该套餐不支持 Waffo 订阅', 404)
    if (!plan.waffo_product_id) throw new SubscriptionError('该套餐尚未开通订阅支付', 503)
    if (!plan.has_accounts) throw new SubscriptionError('该套餐暂无可用服务资源，请联系管理员', 503)
    if (!Number.isFinite(Number(plan.price)) || Number(plan.price) <= 0) throw new SubscriptionError('Waffo 月费必须大于 0', 400)
    const active = await client.query(
      `SELECT id FROM subscription_checkouts WHERE user_id = $1 AND group_id = $2
       AND status IN ('active', 'canceling', 'past_due')
       UNION ALL SELECT id FROM user_subscriptions WHERE user_id = $1 AND group_id = $2
       AND status = 'active' AND expires_at > $3 LIMIT 1`, [user.id, plan.group_id, Date.now()],
    )
    if (active.rows.length) throw new SubscriptionError('该分组已有订阅，请先在订阅管理中处理现有订阅', 409)
    const pending = await client.query<CheckoutRow>(
      `SELECT * FROM subscription_checkouts WHERE user_id = $1 AND group_id = $2
       AND status IN ('creating', 'pending') AND expires_at > $3 ORDER BY created_at DESC LIMIT 1`,
      [user.id, plan.group_id, Date.now()],
    )
    if (pending.rows[0]) {
      const existing = pending.rows[0]
      if (existing.plan_id !== planId) throw new SubscriptionError('该分组还有待付款的套餐，请先完成付款或等待订单过期', 409)
      if (!existing.checkout_url) throw new SubscriptionError('支付会话正在创建，请稍后重试', 409)
      await client.query('COMMIT')
      return checkoutView(existing)
    }
    const id = `sc_${randomBytes(16).toString('hex')}`
    const inserted = await client.query<CheckoutRow>(
      `INSERT INTO subscription_checkouts
       (id, user_id, plan_id, group_id, product_id, store_id, mode, price, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [id, user.id, plan.id, plan.group_id, plan.waffo_product_id, config.WAFFO_STORE_ID,
        config.WAFFO_MODE, plan.price, Date.now() + 30 * 60_000],
    )
    order = inserted.rows[0]
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally { client.release() }
  try {
    const session = await createWaffoSession({
      checkoutId: order.id, planId: order.plan_id, productId: order.product_id,
      price: Number(order.price), email: user.email,
    })
    const saved = await pool.query<CheckoutRow>(
      `UPDATE subscription_checkouts SET session_id = $2, checkout_url = $3, expires_at = $4,
       status = CASE WHEN status = 'creating' THEN 'pending' ELSE status END WHERE id = $1 RETURNING *`,
      [order.id, session.sessionId, session.checkoutUrl, Date.parse(session.expiresAt)],
    )
    return checkoutView(saved.rows[0])
  } catch (error) {
    await pool.query("UPDATE subscription_checkouts SET status = 'failed' WHERE id = $1 AND status = 'creating'", [order.id])
    throw error
  }
}

export async function getSubscriptionCheckout(userId: string, id: string) {
  const { rows } = await pool.query<CheckoutRow>('SELECT * FROM subscription_checkouts WHERE id = $1 AND user_id = $2', [id, userId])
  if (!rows[0]) throw new SubscriptionError('订阅订单不存在', 404)
  return checkoutView(rows[0])
}

const accessEvents = new Set(['subscription.activated', 'subscription.renewed', 'subscription.recovered', 'subscription.canceling', 'subscription.uncanceled'])
const stateEvents = new Set([...accessEvents, 'subscription.canceled', 'subscription.past_due'])

export function paidPeriod(event: WaffoEvent, price: number) {
  const data = event.data
  const start = Date.parse(data.currentPeriodStart ?? '')
  const end = Date.parse(data.currentPeriodEnd ?? '')
  const subtotal = data.planPrice?.subtotal ?? data.subtotal
  const amount = subtotal !== undefined ? Number(subtotal)
    : data.amount !== undefined && data.taxAmount !== undefined ? Number(data.amount) - Number(data.taxAmount) : NaN
  if (data.currency !== 'USD' || data.billingPeriod !== 'monthly' || !['active', 'canceling'].includes(data.orderStatus ?? '')
    || !Number.isFinite(amount) || Math.abs(amount - price) > 0.005) {
    throw new SubscriptionError('Waffo 套餐价格、币种或计费周期不匹配', 400)
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start
    || end - start > 32 * 86_400_000 || start > Date.now() + 86_400_000) {
    throw new SubscriptionError('Waffo 订阅周期无效', 400)
  }
  return { start, end }
}

/** A redirect is never proof of payment. Only verified subscription domain events grant access. */
export async function applyWaffoEvent(event: WaffoEvent): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const externalId = event.data.orderMerchantExternalId
    const { rows } = await client.query<CheckoutRow>(
      `SELECT * FROM subscription_checkouts WHERE ${externalId ? 'id' : 'provider_order_id'} = $1 FOR UPDATE`,
      [externalId ?? event.data.orderId],
    )
    const order = rows[0]
    // Dashboard test events and products outside this app must not grant any access.
    if (!order) { await client.query('COMMIT'); return }
    if (order.mode !== event.mode || order.store_id !== event.storeId
      || (order.provider_order_id && order.provider_order_id !== event.data.orderId)) {
      throw new SubscriptionError('Waffo 订单归属不匹配', 400)
    }
    const metadata = event.data.orderMetadata
    if (metadata?.checkoutId !== order.id || metadata?.planId !== order.plan_id || metadata?.productId !== order.product_id) {
      throw new SubscriptionError('Waffo 订单关联信息不匹配', 400)
    }
    // State events can reuse their entity id (cancel → undo → cancel), so retain their timestamp too.
    const eventKey = `${event.mode}:${event.storeId}:${event.eventType}:${event.eventId}:${event.timestamp}`
    const inserted = await client.query(
      'INSERT INTO subscription_events (id, checkout_id, event_type, payload) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id',
      [eventKey, order.id, event.eventType, JSON.stringify(event)],
    )
    const eventAt = Date.parse(event.timestamp)
    if (!inserted.rows.length || !stateEvents.has(event.eventType) || eventAt < Number(order.event_at)) {
      await client.query('COMMIT'); return
    }
    let subscriptionId = order.subscription_id
    let status = order.status
    if (accessEvents.has(event.eventType) && order.status !== 'canceled') {
      const period = paidPeriod(event, Number(order.price))
      status = event.eventType === 'subscription.canceling' ? 'canceling' : 'active'
      if (!subscriptionId) {
        subscriptionId = `sub_${randomBytes(12).toString('hex')}`
        await client.query(
          `INSERT INTO user_subscriptions
           (id, user_id, plan_id, group_id, status, starts_at, expires_at,
            daily_window_start, weekly_window_start, monthly_window_start, assigned_by,
            billing_period_start, billing_period_end)
           VALUES ($1,$2,$3,$4,'active',$5,$6,$5,$5,$5,'waffo',$5,$6)`,
          [subscriptionId, order.user_id, order.plan_id, order.group_id, period.start, period.end],
        )
      } else {
        // Absolute paid-through date makes duplicate and out-of-order renewal notifications harmless.
        await client.query(
          `UPDATE user_subscriptions SET status = 'active', expires_at = GREATEST(expires_at, $2),
             billing_period_start = GREATEST(COALESCE(billing_period_start, 0), $3),
             billing_period_end = GREATEST(COALESCE(billing_period_end, 0), $2) WHERE id = $1`,
          [subscriptionId, period.end, period.start])
      }
    } else if (event.eventType === 'subscription.canceled') {
      status = 'canceled'
      if (subscriptionId) await client.query("UPDATE user_subscriptions SET status = 'expired', expires_at = LEAST(expires_at, $2) WHERE id = $1", [subscriptionId, eventAt])
    } else if (event.eventType === 'subscription.past_due' && order.status !== 'canceled') {
      // Do not extend access using the unpaid period. Existing paid-through access expires naturally.
      status = 'past_due'
    }
    await client.query(
      'UPDATE subscription_checkouts SET status = $2, provider_order_id = $3, subscription_id = $4, event_at = $5 WHERE id = $1',
      [order.id, status, event.data.orderId, subscriptionId, eventAt],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally { client.release() }
}
