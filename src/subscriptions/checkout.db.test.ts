import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => {
  if (!process.env.TEST_DATABASE_URL) return null
  const url = new URL(process.env.TEST_DATABASE_URL)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_test')) throw new Error('Use a local *_test database')
  const schema = `billing_qa_${Date.now()}_${Math.random().toString(16).slice(2)}`
  url.searchParams.set('options', `-c search_path=${schema}`)
  return { url: url.toString(), schema }
})
const mocks = vi.hoisted(() => ({ session: vi.fn(), enabled: vi.fn(), configured: vi.fn() }))
vi.mock('../config', async original => {
  const actual = await original<typeof import('../config')>()
  return { ...actual, config: { ...actual.config, DATABASE_URL: database?.url ?? actual.config.DATABASE_URL, WAFFO_MODE: 'test', WAFFO_STORE_ID: 'STO_test' } }
})
vi.mock('../payments/providers/waffo', () => ({ createWaffoSession: mocks.session, waffoConfiguration: mocks.configured }))
vi.mock('../db/settings', () => ({ isOnlinePaymentEnabled: mocks.enabled }))
import { pool } from '../db/index'
import { initDb } from '../db/init'
import { seedSubscriptionPlans } from './defaults'
import { purchaseSubscription, deletePlan, listUserSubscriptions, consumeWeightedSubscriptionUsage } from './manager'
import { recordUsage } from '../usage/recorder'
import { emptyUsage } from '../providers/types'
import { createApiKey } from '../keys/manager'
import { userUsageSummary, listUserUsage } from '../users/manager'
import { createSubscriptionCheckout, applyWaffoEvent, getSubscriptionCheckout } from './checkout'
import type { WaffoEvent } from '../payments/providers/waffo'

describe.runIf(database)('Waffo subscription database lifecycle', () => {
  let user: { id: string; email: string }
  const now = Date.now()
  const start = now - 86_400_000
  const end = start + 30 * 86_400_000
  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA ${database!.schema}`)
    await initDb()
    await seedSubscriptionPlans()
    await pool.query("UPDATE subscription_plans SET waffo_product_id = 'PROD_lite' WHERE id = 'plan_lite'")
    await pool.query("INSERT INTO account_group_members (account_id, group_id) VALUES ('test_account', 'grp_subscription_default')")
  })
  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${database!.schema} CASCADE`)
    await pool.end()
  })
  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.enabled.mockResolvedValue(true)
    mocks.configured.mockReturnValue({ configured: true })
    mocks.session.mockImplementation(async () => ({ sessionId: `cs_${randomUUID()}`, checkoutUrl: 'https://pancake.waffo.ai/store/test/checkout/session?test=true', expiresAt: new Date(now + 1800_000).toISOString() }))
    user = { id: randomUUID(), email: `${randomUUID()}@example.com` }
    await pool.query('INSERT INTO users (id,email,name,balance_micros) VALUES ($1,$2,$3,10000000)', [user.id, user.email, 'Billing test'])
  })
  function event(id: string, type = 'subscription.activated', offset = 0): WaffoEvent {
    return {
      id: id + type, eventId: id + type, eventType: type, timestamp: new Date(now + offset).toISOString(), storeId: 'STO_test', mode: 'test',
      data: { orderId: `ORD_${id}`, orderMerchantExternalId: id, orderMetadata: { checkoutId: id, planId: 'plan_lite', productId: 'PROD_lite' },
        currency: 'USD', orderStatus: 'active', billingPeriod: 'monthly', planPrice: { subtotal: '10.00' },
        currentPeriodStart: new Date(start).toISOString(), currentPeriodEnd: new Date(end).toISOString() },
    }
  }
  const create = () => createSubscriptionCheckout(user, 'plan_lite')
  async function subscriptions() { return (await pool.query('SELECT * FROM user_subscriptions WHERE user_id = $1', [user.id])).rows }

  it('seeds three editable tiers exactly once and replays startup/migration safely', async () => {
    await pool.query("UPDATE subscription_plans SET price=35 WHERE id='plan_pro'")
    await pool.query("DELETE FROM subscription_plans WHERE id='plan_max'")
    await seedSubscriptionPlans()
    await initDb()
    const migration = await readFile(new URL('../db/migrations/0015_waffo_subscriptions.sql', import.meta.url), 'utf8')
    await pool.query(migration)
    await pool.query(migration)
    for (const filename of ['0016_subscription_usage_windows.sql', '0017_subscription_usage_ledger.sql']) {
      const sql = await readFile(new URL(`../db/migrations/${filename}`, import.meta.url), 'utf8')
      await pool.query(sql)
      await pool.query(sql)
    }
    const rows = (await pool.query('SELECT id, price FROM subscription_plans ORDER BY sort_order')).rows
    expect(rows).toEqual([{ id: 'plan_lite', price: 10 }, { id: 'plan_pro', price: 35 }])
  })
  it('locks concurrent checkout requests and reuses pending checkout without duplicate payment sessions', async () => {
    const results = await Promise.allSettled([create(), create()])
    expect(results.some(x => x.status === 'fulfilled')).toBe(true)
    expect(mocks.session).toHaveBeenCalledTimes(1)
    const retry = await create()
    expect(retry.checkoutUrl).toContain('pancake.waffo.ai')
    expect(mocks.session).toHaveBeenCalledTimes(1)
  })
  it('does not credit a wallet or create access until a subscription activation arrives', async () => {
    const order = await create()
    expect(await subscriptions()).toHaveLength(0)
    await applyWaffoEvent(event(order.id, 'subscription.payment_succeeded'))
    expect(await subscriptions()).toHaveLength(0)
    const activated = event(order.id)
    await Promise.all([applyWaffoEvent(activated), applyWaffoEvent(activated)])
    expect(await subscriptions()).toHaveLength(1)
    expect(Number((await subscriptions())[0].expires_at)).toBe(end)
    expect(Number((await pool.query('SELECT balance_micros FROM users WHERE id=$1', [user.id])).rows[0].balance_micros)).toBe(10000000)
    expect((await pool.query('SELECT * FROM wallet_transactions WHERE user_id=$1', [user.id])).rows).toHaveLength(0)
    expect((await getSubscriptionCheckout(user.id, order.id)).status).toBe('active')
  })
  it('extends the absolute paid period exactly once and ignores out-of-order activations', async () => {
    const order = await create()
    await applyWaffoEvent(event(order.id))
    const renewed = event(order.id, 'subscription.renewed', 2000)
    // Keep the period start valid relative to the test clock while testing an extended end.
    renewed.data.currentPeriodEnd = new Date(end + 86_400_000).toISOString()
    await applyWaffoEvent(renewed)
    await applyWaffoEvent(renewed)
    await applyWaffoEvent({ ...event(order.id), eventId: 'late-activation', timestamp: new Date(now - 1000).toISOString() })
    expect(await subscriptions()).toHaveLength(1)
    expect(Number((await subscriptions())[0].expires_at)).toBe(end + 86_400_000)
  })
  it('preserves access on cancel request, supports undo, and never revives a terminated subscription', async () => {
    const order = await create()
    await applyWaffoEvent(event(order.id))
    await applyWaffoEvent(event(order.id, 'subscription.canceling', 1000))
    expect((await subscriptions())[0].status).toBe('active')
    expect(Number((await subscriptions())[0].expires_at)).toBe(end)
    expect((await getSubscriptionCheckout(user.id, order.id)).status).toBe('canceling')
    await applyWaffoEvent(event(order.id, 'subscription.uncanceled', 2000))
    expect((await getSubscriptionCheckout(user.id, order.id)).status).toBe('active')
    await applyWaffoEvent(event(order.id, 'subscription.canceled', 3000))
    await applyWaffoEvent(event(order.id, 'subscription.renewed', 4000))
    expect((await subscriptions())[0].status).toBe('expired')
    expect((await getSubscriptionCheckout(user.id, order.id)).status).toBe('canceled')
  })
  it('does not extend the unpaid period after a renewal failure', async () => {
    const order = await create()
    await applyWaffoEvent(event(order.id))
    const pastDue = event(order.id, 'subscription.past_due', 1000)
    pastDue.data.currentPeriodEnd = new Date(end + 30 * 86_400_000).toISOString()
    await applyWaffoEvent(pastDue)
    expect(Number((await subscriptions())[0].expires_at)).toBe(end)
    expect((await getSubscriptionCheckout(user.id, order.id)).status).toBe('past_due')
  })
  it.each(['metadata', 'price', 'currency', 'billingPeriod', 'store', 'mode'])('rejects mismatched %s without consuming the event', async field => {
    const order = await create()
    const notification = event(order.id)
    if (field === 'metadata') notification.data.orderMetadata = { checkoutId: order.id, planId: 'wrong' }
    if (field === 'price') notification.data.planPrice = { subtotal: '0.01' }
    if (field === 'currency') notification.data.currency = 'CNY'
    if (field === 'billingPeriod') notification.data.billingPeriod = 'yearly'
    if (field === 'store') notification.storeId = 'STO_other'
    if (field === 'mode') notification.mode = 'prod'
    await expect(applyWaffoEvent(notification)).rejects.toMatchObject({ statusCode: 400 })
    expect(await subscriptions()).toHaveLength(0)
    expect((await pool.query('SELECT id FROM subscription_events WHERE checkout_id=$1', [order.id])).rows).toHaveLength(0)
  })
  it('accepts a genuine late-paid notification even if its checkout URL has expired', async () => {
    const order = await create()
    await pool.query('UPDATE subscription_checkouts SET expires_at = $2 WHERE id = $1', [order.id, now - 1000])
    expect((await getSubscriptionCheckout(user.id, order.id)).status).toBe('expired')
    await applyWaffoEvent(event(order.id))
    expect((await getSubscriptionCheckout(user.id, order.id)).status).toBe('active')
  })
  it('blocks wallet bypass, cross-user status reads, and duplicate active subscriptions', async () => {
    const order = await create()
    await expect(getSubscriptionCheckout('other-user', order.id)).rejects.toMatchObject({ statusCode: 404 })
    await expect(purchaseSubscription(user.id, 'plan_lite')).rejects.toMatchObject({ statusCode: 400 })
    await applyWaffoEvent(event(order.id))
    await expect(create()).rejects.toMatchObject({ statusCode: 409 })
    await expect(deletePlan('plan_lite')).rejects.toMatchObject({ statusCode: 409 })
  })
  it('blocks new checkouts while disabled but continues to apply verified payments', async () => {
    const order = await create()
    mocks.enabled.mockResolvedValue(false)
    await expect(create()).rejects.toMatchObject({ statusCode: 403 })
    await applyWaffoEvent(event(order.id))
    expect(await subscriptions()).toHaveLength(1)
  })
  it('ignores unrelated product and dashboard sample notifications', async () => {
    await applyWaffoEvent(event('unrelated'))
    expect(await subscriptions()).toHaveLength(0)
  })

  it('shares actual weighted usage across keys and excludes it from wallet fees', async () => {
    const order = await create()
    await applyWaffoEvent(event(order.id))
    const subscription = (await subscriptions())[0]
    const keys = await Promise.all(['A', 'B'].map(name => createApiKey({ userId: user.id, name, accountGroupId: 'grp_subscription_default' })))
    const results = await Promise.all(keys.map(key => recordUsage({
      apiKeyId: key.id, userId: user.id, accountId: null, provider: 'claude', model: 'claude-sonnet-4',
      usage: { ...emptyUsage(), inputTokens: 1000, outputTokens: 1000, usageSource: 'upstream' },
      status: 'success', latencyMs: 10, billTo: 'subscription', subscriptionId: subscription.id,
      subscriptionQuotaMode: 'usage', multiplier: 3,
    })))
    expect(results).toEqual([true, true])
    const [view] = await listUserSubscriptions(user.id)
    expect(view.quotaMode).toBe('usage')
    expect(view.usageWindows.map(window => window.used)).toEqual([144, 144, 144])
    expect(view.usageWindows[0].percent).toBeCloseTo(1.2)
    const history = await listUserUsage(user.id, 1, 10)
    expect(history.logs.map(row => row.subscriptionPoints)).toEqual([72, 72])
    expect((await userUsageSummary(user.id)).cost24h).toBe(0)
    expect((await pool.query('SELECT * FROM wallet_transactions WHERE user_id=$1', [user.id])).rows).toHaveLength(0)
    expect(Number((await pool.query('SELECT balance_micros FROM users WHERE id=$1', [user.id])).rows[0].balance_micros)).toBe(10000000)

    const renewed = event(order.id, 'subscription.renewed', 1000)
    renewed.data.currentPeriodStart = new Date(now).toISOString()
    renewed.data.currentPeriodEnd = new Date(now + 30 * 86_400_000).toISOString()
    await applyWaffoEvent(renewed)
    await applyWaffoEvent(renewed)
    const [after] = await listUserSubscriptions(user.id)
    expect(after.usageWindows.map(window => window.used)).toEqual([144, 144, 0])
  })

  it('serializes concurrent completions and retains over-limit usage without a wallet debit', async () => {
    const order = await create()
    await applyWaffoEvent(event(order.id))
    const subscriptionId = (await subscriptions())[0].id
    await Promise.all([7000, 7000].map(async points => {
      const client = await pool.connect()
      try { await client.query('BEGIN'); await consumeWeightedSubscriptionUsage(client, subscriptionId, points, Date.now(), 'deepseek-flash'); await client.query('COMMIT') }
      finally { client.release() }
    }))
    const [view] = await listUserSubscriptions(user.id)
    expect(view.usageWindows[0]).toMatchObject({ used: 14000, remaining: 0, percent: 100 })
    expect(view.usageWindows[1].used).toBe(14000)
    expect((await pool.query('SELECT * FROM wallet_transactions WHERE user_id=$1', [user.id])).rows).toHaveLength(0)
  })
})
