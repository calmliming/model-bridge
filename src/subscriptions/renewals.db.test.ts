import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => {
  if (!process.env.TEST_DATABASE_URL) return null
  const url = new URL(process.env.TEST_DATABASE_URL)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_test')) throw new Error('Use a local *_test database')
  const schema = `renewal_qa_${Date.now()}_${Math.random().toString(16).slice(2)}`
  url.searchParams.set('options', `-c search_path=${schema}`)
  return { url: url.toString(), schema }
})
vi.mock('../config', async original => {
  const actual = await original<typeof import('../config')>()
  return { ...actual, config: { ...actual.config, DATABASE_URL: database?.url ?? actual.config.DATABASE_URL } }
})
import { pool } from '../db/index'
import { initDb } from '../db/init'
import { assignSubscription, purchaseSubscription, resolveActiveSubscription } from './manager'

const DAY = 86_400_000

describe.runIf(database)('wallet subscription renewal integrity', () => {
  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA ${database!.schema}`)
    await initDb()
  }, 30_000)
  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${database!.schema} CASCADE`)
    await pool.end()
  })
  beforeEach(async () => {
    await pool.query('TRUNCATE subscription_checkouts, user_subscriptions, subscription_plans, wallet_transactions, users')
    await pool.query("INSERT INTO users (id,email,name,balance_micros) VALUES ('user_1','renewal@example.com','Renewal',1000000000)")
    await pool.query(`INSERT INTO subscription_plans (id,name,group_id,price,validity_days,for_sale,payment_provider,daily_limit_usd)
      VALUES ('low','Low','group_1',10,365,TRUE,'wallet',1), ('high','High','group_1',100,30,TRUE,'wallet',100)`)
  })
  const rows = async () => (await pool.query('SELECT * FROM user_subscriptions ORDER BY id')).rows
  const balance = async () => Number((await pool.query("SELECT balance_micros FROM users WHERE id='user_1'")).rows[0].balance_micros)
  const transactions = async () => (await pool.query('SELECT * FROM wallet_transactions')).rows

  it('rejects a higher tier without changing paid time, plan, limits, or wallet', async () => {
    await purchaseSubscription('user_1', 'low')
    const before = await rows()
    await expect(purchaseSubscription('user_1', 'high')).rejects.toMatchObject({ statusCode: 409 })
    expect(await rows()).toEqual(before)
    expect((await resolveActiveSubscription('user_1', 'group_1'))?.planLimits.daily).toBe(1)
    expect(await balance()).toBe(990_000_000)
    expect(await transactions()).toHaveLength(1)
  })

  it('extends the same plan without replacing the row or resetting usage', async () => {
    const first = await purchaseSubscription('user_1', 'low')
    await pool.query('UPDATE user_subscriptions SET daily_usage_usd=0.5, weekly_usage_usd=2, monthly_usage_usd=3 WHERE id=$1', [first.id])
    const before = (await rows())[0]
    const second = await purchaseSubscription('user_1', 'low')
    expect(second.id).toBe(first.id)
    expect((await rows())[0]).toMatchObject({ ...before, expires_at: Number(before.expires_at) + 365 * DAY })
    expect(await balance()).toBe(980_000_000)
    expect(await transactions()).toHaveLength(2)
  })

  it('allows another plan after the original subscription expires', async () => {
    await purchaseSubscription('user_1', 'low')
    await pool.query('UPDATE user_subscriptions SET expires_at=$1', [Date.now() - 1])
    await purchaseSubscription('user_1', 'high')
    expect(await rows()).toHaveLength(2)
    expect((await resolveActiveSubscription('user_1', 'group_1'))?.planLimits.daily).toBe(100)
  })

  it('prevents local renewal of a subscription associated with Waffo even if its plan was changed to wallet', async () => {
    const subscription = await purchaseSubscription('user_1', 'low')
    await pool.query(`INSERT INTO subscription_checkouts
      (id,user_id,plan_id,group_id,product_id,store_id,mode,price,status,subscription_id,expires_at)
      VALUES ('checkout_1','user_1','low','group_1','product_1','store_1','test',10,'active',$1,$2)`,
    [subscription.id, Date.now() + DAY])
    const before = await rows()
    await expect(purchaseSubscription('user_1', 'low')).rejects.toMatchObject({ statusCode: 409 })
    await expect(assignSubscription({ userId: 'user_1', planId: 'low', assignedBy: 'admin' })).rejects.toMatchObject({ statusCode: 409 })
    expect(await rows()).toEqual(before)
    expect(await balance()).toBe(990_000_000)
    expect(await transactions()).toHaveLength(1)
  })

  it.each([0, 10])('serializes first purchases of different plans when the first tier costs $%i', async price => {
    await pool.query("UPDATE subscription_plans SET price=$1 WHERE id='low'", [price])
    const outcomes = await Promise.allSettled([purchaseSubscription('user_1', 'low'), purchaseSubscription('user_1', 'high')])
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.find(result => result.status === 'rejected')).toMatchObject({ reason: { statusCode: 409 } })
    const subscriptions = await rows()
    expect(subscriptions).toHaveLength(1)
    const paid = subscriptions[0].plan_id === 'low' ? price : 100
    expect(await balance()).toBe(1_000_000_000 - paid * 1_000_000)
    expect(await transactions()).toHaveLength(paid > 0 ? 1 : 0)
  })

  it('rolls a tentative renewal back when there is insufficient wallet balance', async () => {
    await purchaseSubscription('user_1', 'low')
    const before = await rows()
    await pool.query("UPDATE users SET balance_micros=0 WHERE id='user_1'")
    await expect(purchaseSubscription('user_1', 'low')).rejects.toMatchObject({ statusCode: 402 })
    expect(await rows()).toEqual(before)
    expect(await transactions()).toHaveLength(1)
  })
})
