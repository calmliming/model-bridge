import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => {
  if (!process.env.TEST_DATABASE_URL) return null
  const url = new URL(process.env.TEST_DATABASE_URL)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_test')) throw new Error('Use a local *_test database')
  const schema = `go_usage_${Date.now()}_${Math.random().toString(16).slice(2)}`
  url.searchParams.set('options', `-c search_path=${schema}`)
  return { url: url.toString(), schema }
})
vi.mock('../config', async original => {
  const actual = await original<typeof import('../config')>()
  return { ...actual, config: { ...actual.config, DATABASE_URL: database?.url ?? actual.config.DATABASE_URL } }
})
import { pool } from '../db/index'
import { initDb } from '../db/init'
import { seedSubscriptionPlans } from './defaults'
import { consumeWeightedSubscriptionUsage, listPlans, updatePlan } from './manager'

describe.runIf(database)('Go reference subscriptions', () => {
  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA ${database!.schema}`)
    await initDb()
  }, 30000)
  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${database!.schema} CASCADE`)
    await pool.end()
  })
  beforeEach(async () => {
    await pool.query('TRUNCATE subscription_checkouts, user_subscriptions, subscription_plans, users, settings')
    await seedSubscriptionPlans()
  })
  async function legacy() {
    await pool.query("UPDATE subscription_plans SET usage_profile='base',five_hour_limit_points=2000,weekly_limit_points=10000,monthly_limit_points=30000 WHERE id='plan_lite'")
    await pool.query("DELETE FROM settings WHERE key='subscription_opencode_go_20260929'")
  }
  async function plan() {
    return (await pool.query("SELECT usage_profile,five_hour_limit_points,weekly_limit_points,monthly_limit_points FROM subscription_plans WHERE id='plan_lite'")).rows[0]
  }
  async function subscribe() {
    const now = Date.now()
    await pool.query("INSERT INTO users (id,email,name) VALUES ('user_test','go@example.com','Go test')")
    await pool.query(`INSERT INTO user_subscriptions
      (id,user_id,plan_id,group_id,status,starts_at,expires_at,daily_window_start,weekly_window_start,monthly_window_start)
      VALUES ('sub_test','user_test','plan_lite','grp_subscription_default','active',$1,$2,$1,$1,$1)`, [now, now + 30 * 86400000])
  }
  async function consume(model: string, points: number) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const charged = await consumeWeightedSubscriptionUsage(client, 'sub_test', points, Date.now(), model)
      await client.query('COMMIT')
      return charged
    } catch (error) { await client.query('ROLLBACK'); throw error }
    finally { client.release() }
  }

  it('seeds the retained prices and scaled 20/50/100 percent Go limits', async () => {
    const plans = await listPlans()
    expect(plans.map(p => [p.price, p.fiveHourLimitPoints, p.weeklyLimitPoints, p.monthlyLimitPoints, p.usageProfile])).toEqual([
      [10, 12000, 30000, 60000, 'opencode-go'],
      [30, 36000, 90000, 180000, 'opencode-go'],
      [100, 120000, 300000, 600000, 'opencode-go'],
    ])
    expect(plans[0].usageBands.map(band => band.monthlyReferenceUsd)).toEqual([60, 30, 15])
  })
  it('replays the profile migration without changing existing values', async () => {
    const migration = await readFile(new URL('../db/migrations/0019_subscription_usage_profile.sql', import.meta.url), 'utf8')
    await pool.query(migration)
    await pool.query(migration)
    expect((await plan()).usage_profile).toBe('opencode-go')
  })
  it('upgrades unchanged unsold defaults once and preserves later edits', async () => {
    await legacy()
    await seedSubscriptionPlans()
    expect(await plan()).toEqual({ usage_profile: 'opencode-go', five_hour_limit_points: 12000, weekly_limit_points: 30000, monthly_limit_points: 60000 })
    await updatePlan('plan_lite', { usageProfile: 'base', monthlyLimitPoints: 65000 })
    await seedSubscriptionPlans()
    expect(await plan()).toMatchObject({ usage_profile: 'base', monthly_limit_points: 65000 })
  })
  it.each(['subscription', 'checkout', 'price', 'quota', 'name', 'profile'])('preserves an existing %s instead of replacing its billing rules', async kind => {
    await legacy()
    if (kind === 'subscription') await subscribe()
    if (kind === 'checkout') {
      await pool.query(`INSERT INTO subscription_checkouts
        (id,user_id,plan_id,group_id,product_id,store_id,mode,price,expires_at)
        VALUES ('checkout_test','user_test','plan_lite','grp_subscription_default','PROD_test','STO_test','test',10,9999999999999)`)
    }
    if (kind === 'price') await pool.query("UPDATE subscription_plans SET price=12 WHERE id='plan_lite'")
    if (kind === 'quota') await pool.query("UPDATE subscription_plans SET monthly_limit_points=31000 WHERE id='plan_lite'")
    if (kind === 'name') await pool.query("UPDATE subscription_plans SET name='Custom' WHERE id='plan_lite'")
    if (kind === 'profile') await pool.query("UPDATE subscription_plans SET usage_profile='opencode-go' WHERE id='plan_lite'")
    const before = await plan()
    await seedSubscriptionPlans()
    expect(await plan()).toEqual(before)
  })
  it('charges mixed models to one shared set of counters', async () => {
    await subscribe()
    expect(await consume('deepseek-flash', 1000)).toBe(1000)
    expect(await consume('deepseek-v4-flash', 1000)).toBe(2000)
    expect(await consume('kimi-k3', 1000)).toBe(4000)
    const row = (await pool.query("SELECT five_hour_usage_points,weekly_usage_points,monthly_usage_points FROM user_subscriptions WHERE id='sub_test'")).rows[0]
    expect(Object.values(row)).toEqual([7000, 7000, 7000])
  })
  it('keeps legacy subscribers at their original 1x weights', async () => {
    await legacy()
    await subscribe()
    await seedSubscriptionPlans()
    expect(await consume('kimi-k3', 1000)).toBe(1000)
    expect((await plan()).usage_profile).toBe('base')
  })
})
