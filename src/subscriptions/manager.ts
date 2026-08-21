import { randomBytes } from 'node:crypto'
import type { PoolClient } from 'pg'
import { pool } from '../db/index'
import { applyWalletTransactionWithClient } from '../wallet/manager'
import { usdToMicros } from '../wallet/money'

const DAY_MS = 24 * 60 * 60_000
const WEEK_MS = 7 * DAY_MS
const MONTH_MS = 30 * DAY_MS

export class SubscriptionError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message)
  }
}

export interface PlanView {
  id: string
  name: string
  description: string | null
  groupId: string
  groupName: string | null
  price: number
  dailyLimitUsd: number | null
  weeklyLimitUsd: number | null
  monthlyLimitUsd: number | null
  validityDays: number
  forSale: boolean
  sortOrder: number
  createdAt: number
}

export interface SubscriptionView {
  id: string
  userId: string
  planId: string
  planName: string | null
  groupId: string
  groupName: string | null
  status: string
  startsAt: number
  expiresAt: number
  dailyLimitUsd: number | null
  weeklyLimitUsd: number | null
  monthlyLimitUsd: number | null
  dailyUsageUsd: number
  weeklyUsageUsd: number
  monthlyUsageUsd: number
  dailyRemaining: number | null
  weeklyRemaining: number | null
  monthlyRemaining: number | null
  createdAt: number
}

interface SubRow {
  id: string
  user_id: string
  plan_id: string
  group_id: string
  status: string
  starts_at: string | number
  expires_at: string | number
  daily_window_start: string | number
  weekly_window_start: string | number
  monthly_window_start: string | number
  daily_usage_usd: string | number
  weekly_usage_usd: string | number
  monthly_usage_usd: string | number
}

function planId(): string {
  return `plan_${randomBytes(9).toString('hex')}`
}

function subId(): string {
  return `sub_${randomBytes(9).toString('hex')}`
}

/**
 * Lazily rolls each usage window forward: if a window's start is older than its
 * period, the window resets (usage → 0, start → now) before any limit check.
 * Returns the effective (post-reset) usage figures. Pure — callers persist.
 */
export function rolledWindows(sub: SubRow, now: number) {
  const dStart = Number(sub.daily_window_start)
  const wStart = Number(sub.weekly_window_start)
  const mStart = Number(sub.monthly_window_start)
  const daily = now - dStart >= DAY_MS
    ? { start: now, usage: 0 }
    : { start: dStart, usage: Number(sub.daily_usage_usd) }
  const weekly = now - wStart >= WEEK_MS
    ? { start: now, usage: 0 }
    : { start: wStart, usage: Number(sub.weekly_usage_usd) }
  const monthly = now - mStart >= MONTH_MS
    ? { start: now, usage: 0 }
    : { start: mStart, usage: Number(sub.monthly_usage_usd) }
  return { daily, weekly, monthly }
}

// SUBSCRIPTION_MANAGER_APPEND_MARKER

export interface SubscriptionBillingState {
  subscriptionId: string
  planLimits: { daily: number | null; weekly: number | null; monthly: number | null }
}

/**
 * Returns the active subscription a user holds for a group (not expired), with
 * its plan limits, or null. Used by the billing gate to decide whether a
 * request can be charged to a subscription rather than the wallet.
 */
export async function resolveActiveSubscription(
  userId: string,
  groupId: string,
  now = Date.now(),
): Promise<SubscriptionBillingState | null> {
  const { rows } = await pool.query<SubRow & {
    daily_limit_usd: number | null
    weekly_limit_usd: number | null
    monthly_limit_usd: number | null
  }>(
    `SELECT s.id, s.expires_at,
            p.daily_limit_usd, p.weekly_limit_usd, p.monthly_limit_usd
     FROM user_subscriptions s
     JOIN subscription_plans p ON p.id = s.plan_id
     WHERE s.user_id = $1 AND s.group_id = $2 AND s.status = 'active'
       AND s.expires_at > $3
     ORDER BY s.expires_at DESC
     LIMIT 1`,
    [userId, groupId, now],
  )
  const row = rows[0]
  if (!row) return null
  return {
    subscriptionId: row.id,
    planLimits: {
      daily: row.daily_limit_usd == null ? null : Number(row.daily_limit_usd),
      weekly: row.weekly_limit_usd == null ? null : Number(row.weekly_limit_usd),
      monthly: row.monthly_limit_usd == null ? null : Number(row.monthly_limit_usd),
    },
  }
}

/**
 * Whether the subscription has any window headroom right now (after lazy
 * window rollover). A null limit means that window is unlimited. Returns false
 * only when every defined window is already at/over its limit.
 */
export async function hasWindowHeadroom(
  subscriptionId: string,
  limits: { daily: number | null; weekly: number | null; monthly: number | null },
  now = Date.now(),
): Promise<boolean> {
  const { rows } = await pool.query<SubRow>(
    `SELECT * FROM user_subscriptions WHERE id = $1`,
    [subscriptionId],
  )
  const sub = rows[0]
  if (!sub) return false
  const w = rolledWindows(sub, now)
  if (limits.daily != null && w.daily.usage >= limits.daily) return false
  if (limits.weekly != null && w.weekly.usage >= limits.weekly) return false
  if (limits.monthly != null && w.monthly.usage >= limits.monthly) return false
  return true
}

/**
 * Atomically consumes a request's cost from a subscription. The subscription
 * row is locked while the rolling windows and all configured limits are
 * checked, so concurrent requests cannot collectively spend past a quota.
 * Returns false when the subscription is missing, expired, or lacks room in
 * any defined window; callers can then fall back to the user's wallet.
 */
export async function consumeSubscriptionUsage(
  client: Pick<PoolClient, 'query'>,
  subscriptionId: string,
  cost: number,
  now = Date.now(),
): Promise<boolean> {
  if (!Number.isFinite(cost) || cost < 0) {
    throw new Error('subscription cost must be a finite non-negative number')
  }
  if (cost === 0) return true

  const { rows } = await client.query<SubRow & {
    daily_limit_usd: number | string | null
    weekly_limit_usd: number | string | null
    monthly_limit_usd: number | string | null
  }>(
    `SELECT s.*, p.daily_limit_usd, p.weekly_limit_usd, p.monthly_limit_usd
     FROM user_subscriptions s
     JOIN subscription_plans p ON p.id = s.plan_id
     WHERE s.id = $1
     FOR UPDATE OF s`,
    [subscriptionId],
  )
  const sub = rows[0]
  if (!sub || sub.status !== 'active' || Number(sub.expires_at) <= now) return false

  const windows = rolledWindows(sub, now)
  const limits = {
    daily: sub.daily_limit_usd == null ? null : Number(sub.daily_limit_usd),
    weekly: sub.weekly_limit_usd == null ? null : Number(sub.weekly_limit_usd),
    monthly: sub.monthly_limit_usd == null ? null : Number(sub.monthly_limit_usd),
  }
  // Costs are rounded to micro-USD before this function is called. Keep a
  // tiny epsilon for PostgreSQL DOUBLE PRECISION representation noise.
  const epsilon = 1e-9
  if (
    (limits.daily != null && windows.daily.usage + cost > limits.daily + epsilon) ||
    (limits.weekly != null && windows.weekly.usage + cost > limits.weekly + epsilon) ||
    (limits.monthly != null && windows.monthly.usage + cost > limits.monthly + epsilon)
  ) {
    return false
  }

  await client.query(
    `UPDATE user_subscriptions
       SET daily_window_start = $1, daily_usage_usd = $2,
           weekly_window_start = $3, weekly_usage_usd = $4,
           monthly_window_start = $5, monthly_usage_usd = $6
     WHERE id = $7`,
    [
      windows.daily.start, windows.daily.usage + cost,
      windows.weekly.start, windows.weekly.usage + cost,
      windows.monthly.start, windows.monthly.usage + cost,
      subscriptionId,
    ],
  )
  return true
}

/**
 * Adds `cost` to all three usage windows (rolling each forward first) inside
 * the caller's transaction. Charges at sale price, matching the limit units.
 */
export async function incrementSubscriptionUsage(
  client: Pick<PoolClient, 'query'>,
  subscriptionId: string,
  cost: number,
  now = Date.now(),
): Promise<void> {
  const { rows } = await client.query<SubRow>(
    `SELECT * FROM user_subscriptions WHERE id = $1 FOR UPDATE`,
    [subscriptionId],
  )
  const sub = rows[0]
  if (!sub) return
  const w = rolledWindows(sub, now)
  await client.query(
    `UPDATE user_subscriptions
       SET daily_window_start = $1, daily_usage_usd = $2,
           weekly_window_start = $3, weekly_usage_usd = $4,
           monthly_window_start = $5, monthly_usage_usd = $6
     WHERE id = $7`,
    [
      w.daily.start, w.daily.usage + cost,
      w.weekly.start, w.weekly.usage + cost,
      w.monthly.start, w.monthly.usage + cost,
      subscriptionId,
    ],
  )
}

// SUBSCRIPTION_CRUD_APPEND_MARKER

export interface CreatePlanInput {
  name: string
  description?: string | null
  groupId: string
  price?: number
  dailyLimitUsd?: number | null
  weeklyLimitUsd?: number | null
  monthlyLimitUsd?: number | null
  validityDays?: number
  forSale?: boolean
  sortOrder?: number
}

export async function createPlan(input: CreatePlanInput): Promise<{ id: string }> {
  const id = planId()
  await pool.query(
    `INSERT INTO subscription_plans
       (id, name, description, group_id, price, daily_limit_usd, weekly_limit_usd,
        monthly_limit_usd, validity_days, for_sale, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id, input.name, input.description ?? null, input.groupId, input.price ?? 0,
      input.dailyLimitUsd ?? null, input.weeklyLimitUsd ?? null, input.monthlyLimitUsd ?? null,
      input.validityDays ?? 30, input.forSale ?? false, input.sortOrder ?? 0,
    ],
  )
  return { id }
}

export async function updatePlan(id: string, patch: Partial<CreatePlanInput>): Promise<void> {
  const cols: Record<string, string> = {
    name: 'name', description: 'description', groupId: 'group_id', price: 'price',
    dailyLimitUsd: 'daily_limit_usd', weeklyLimitUsd: 'weekly_limit_usd',
    monthlyLimitUsd: 'monthly_limit_usd', validityDays: 'validity_days',
    forSale: 'for_sale', sortOrder: 'sort_order',
  }
  const sets: string[] = []
  const values: unknown[] = []
  for (const [key, col] of Object.entries(cols)) {
    if (key in patch) {
      values.push((patch as Record<string, unknown>)[key])
      sets.push(`${col} = $${values.length}`)
    }
  }
  if (!sets.length) return
  values.push(id)
  await pool.query(`UPDATE subscription_plans SET ${sets.join(', ')} WHERE id = $${values.length}`, values)
}

export async function deletePlan(id: string): Promise<void> {
  await pool.query(`DELETE FROM subscription_plans WHERE id = $1`, [id])
}

function asPlan(row: Record<string, unknown>): PlanView {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    groupId: row.group_id as string,
    groupName: (row.group_name as string | null) ?? null,
    price: Number(row.price),
    dailyLimitUsd: row.daily_limit_usd == null ? null : Number(row.daily_limit_usd),
    weeklyLimitUsd: row.weekly_limit_usd == null ? null : Number(row.weekly_limit_usd),
    monthlyLimitUsd: row.monthly_limit_usd == null ? null : Number(row.monthly_limit_usd),
    validityDays: Number(row.validity_days),
    forSale: !!row.for_sale,
    sortOrder: Number(row.sort_order),
    createdAt: Number(row.created_at),
  }
}

/** Lists plans. `onlyForSale` restricts to store-visible plans for the user portal. */
export async function listPlans(onlyForSale = false): Promise<PlanView[]> {
  const where = onlyForSale ? 'WHERE p.for_sale = TRUE' : ''
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT p.*, g.name AS group_name
     FROM subscription_plans p
     LEFT JOIN account_groups g ON g.id = p.group_id
     ${where}
     ORDER BY p.sort_order ASC, p.created_at DESC`,
  )
  return rows.map(asPlan)
}

async function getPlan(client: Pick<PoolClient, 'query'>, id: string): Promise<Record<string, unknown> | null> {
  const { rows } = await client.query<Record<string, unknown>>(
    `SELECT * FROM subscription_plans WHERE id = $1`,
    [id],
  )
  return rows[0] ?? null
}

/**
 * Grants `planId` to a user inside the given transaction. If the user already
 * has an active subscription to the plan's group, its validity is extended
 * (no new row, usage windows untouched). Otherwise a fresh subscription with
 * reset windows is created. Returns the subscription id.
 */
async function grantSubscription(
  client: Pick<PoolClient, 'query'>,
  userId: string,
  plan: Record<string, unknown>,
  assignedBy: string,
  note: string | null,
  now: number,
): Promise<string> {
  const groupId = plan.group_id as string
  const validityMs = Number(plan.validity_days) * DAY_MS
  const existing = await client.query<{ id: string; expires_at: string | number }>(
    `SELECT id, expires_at FROM user_subscriptions
     WHERE user_id = $1 AND group_id = $2 AND status = 'active' AND expires_at > $3
     ORDER BY expires_at DESC LIMIT 1
     FOR UPDATE`,
    [userId, groupId, now],
  )
  if (existing.rows[0]) {
    const id = existing.rows[0].id
    const base = Number(existing.rows[0].expires_at)
    await client.query(
      `UPDATE user_subscriptions SET expires_at = $1, plan_id = $2 WHERE id = $3`,
      [base + validityMs, plan.id, id],
    )
    return id
  }
  const id = subId()
  await client.query(
    `INSERT INTO user_subscriptions
       (id, user_id, plan_id, group_id, status, starts_at, expires_at,
        daily_window_start, weekly_window_start, monthly_window_start,
        daily_usage_usd, weekly_usage_usd, monthly_usage_usd, assigned_by, note)
     VALUES ($1, $2, $3, $4, 'active', $5, $6, $5, $5, $5, 0, 0, 0, $7, $8)`,
    [id, userId, plan.id, groupId, now, now + validityMs, assignedBy, note],
  )
  return id
}

/** Admin: assign a subscription to a user (free grant). */
export async function assignSubscription(input: {
  userId: string
  planId: string
  assignedBy: string
  note?: string | null
}): Promise<{ id: string }> {
  const now = Date.now()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const plan = await getPlan(client, input.planId)
    if (!plan) throw new SubscriptionError('plan not found', 404)
    const id = await grantSubscription(client, input.userId, plan, input.assignedBy, input.note ?? null, now)
    await client.query('COMMIT')
    return { id }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** User: buy a for-sale plan with wallet balance (atomic debit + grant). */
export async function purchaseSubscription(userId: string, planIdInput: string): Promise<{ id: string }> {
  const now = Date.now()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const plan = await getPlan(client, planIdInput)
    if (!plan || !plan.for_sale) throw new SubscriptionError('plan not available', 404)
    const priceMicros = usdToMicros(Number(plan.price))
    if (priceMicros > 0) {
      const balance = await client.query<{ balance_micros: string | number }>(
        `SELECT balance_micros FROM users WHERE id = $1 FOR UPDATE`,
        [userId],
      )
      if (!balance.rows[0]) throw new SubscriptionError('user not found', 404)
      if (Number(balance.rows[0].balance_micros) < priceMicros) {
        throw new SubscriptionError('余额不足，无法购买该套餐', 402)
      }
      await applyWalletTransactionWithClient(client, {
        userId,
        type: 'debit',
        amountMicros: -priceMicros,
        note: `purchase subscription ${plan.name as string}`,
        createdBy: 'purchase',
      })
    }
    const id = await grantSubscription(client, userId, plan, 'purchase', null, now)
    await client.query('COMMIT')
    return { id }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** Lists a user's subscriptions with effective (post-rollover) remaining budgets. */
export async function listUserSubscriptions(userId: string, now = Date.now()): Promise<SubscriptionView[]> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT s.*, p.name AS plan_name, p.daily_limit_usd, p.weekly_limit_usd,
            p.monthly_limit_usd, g.name AS group_name
     FROM user_subscriptions s
     JOIN subscription_plans p ON p.id = s.plan_id
     LEFT JOIN account_groups g ON g.id = s.group_id
     WHERE s.user_id = $1
     ORDER BY s.expires_at DESC`,
    [userId],
  )
  return rows.map((row) => {
    const w = rolledWindows(row as unknown as SubRow, now)
    const dl = row.daily_limit_usd == null ? null : Number(row.daily_limit_usd)
    const wl = row.weekly_limit_usd == null ? null : Number(row.weekly_limit_usd)
    const ml = row.monthly_limit_usd == null ? null : Number(row.monthly_limit_usd)
    const expired = Number(row.expires_at) <= now
    return {
      id: row.id as string,
      userId: row.user_id as string,
      planId: row.plan_id as string,
      planName: (row.plan_name as string | null) ?? null,
      groupId: row.group_id as string,
      groupName: (row.group_name as string | null) ?? null,
      status: expired ? 'expired' : (row.status as string),
      startsAt: Number(row.starts_at),
      expiresAt: Number(row.expires_at),
      dailyLimitUsd: dl,
      weeklyLimitUsd: wl,
      monthlyLimitUsd: ml,
      dailyUsageUsd: w.daily.usage,
      weeklyUsageUsd: w.weekly.usage,
      monthlyUsageUsd: w.monthly.usage,
      dailyRemaining: dl == null ? null : Math.max(0, dl - w.daily.usage),
      weeklyRemaining: wl == null ? null : Math.max(0, wl - w.weekly.usage),
      monthlyRemaining: ml == null ? null : Math.max(0, ml - w.monthly.usage),
      createdAt: Number(row.created_at),
    }
  })
}

/** Admin: list a single user's subscriptions (same shape as the user view). */
export async function listSubscriptionsForUser(userId: string): Promise<SubscriptionView[]> {
  return listUserSubscriptions(userId)
}

