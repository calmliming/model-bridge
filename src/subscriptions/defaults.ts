import { pool } from '../db/index'

export const DEFAULT_SUBSCRIPTION_PLANS = [
  { id: 'plan_lite', name: 'Lite', price: 10, daily: 2, weekly: 10, monthly: 30, description: '轻量任务与日常编程，提供标准订阅用量。' },
  { id: 'plan_pro', name: 'Pro', price: 30, daily: 6, weekly: 30, monthly: 90, description: '持续开发与多轮任务，提供 3 倍标准用量。' },
  { id: 'plan_max', name: 'Max', price: 100, daily: 20, weekly: 100, monthly: 300, description: '高频开发与复杂任务，提供 10 倍标准用量。' },
] as const

/** Seed once, never overwrite an edited plan or resurrect one an admin deleted. */
export async function seedSubscriptionPlans(): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtext('subscription-plan-defaults-v1'))")
    const seeded = await client.query("SELECT value FROM settings WHERE key = 'subscription_plan_defaults_v1'")
    if (!seeded.rows.length) {
      const groups = await client.query('SELECT id FROM account_groups ORDER BY created_at ASC, id ASC LIMIT 1')
      const groupId = groups.rows[0]?.id ?? 'grp_subscription_default'
      if (!groups.rows.length) {
        await client.query("INSERT INTO account_groups (id, name, description) VALUES ($1, '订阅套餐', '请在分组管理中添加用于套餐的上游账户') ON CONFLICT DO NOTHING", [groupId])
      }
      for (const [index, plan] of DEFAULT_SUBSCRIPTION_PLANS.entries()) {
        await client.query(
          `INSERT INTO subscription_plans
           (id, name, description, group_id, price, daily_limit_usd, weekly_limit_usd, monthly_limit_usd,
            validity_days, for_sale, sort_order, payment_provider)
           SELECT $1, $2, $3, $4, $5, $6, $7, $8, 30, TRUE, $9, 'waffo'
           WHERE NOT EXISTS (SELECT 1 FROM subscription_plans WHERE lower(name) = lower($2))
           ON CONFLICT (id) DO NOTHING`,
          [plan.id, plan.name, plan.description, groupId, plan.price, plan.daily, plan.weekly, plan.monthly, index],
        )
      }
      await client.query("INSERT INTO settings (key, value) VALUES ('subscription_plan_defaults_v1', '1')")
    }
    const upgraded = await client.query("SELECT value FROM settings WHERE key = 'subscription_usage_windows_v1'")
    if (!upgraded.rows.length) {
      const oldDescriptions = ['适合轻量体验与个人日常使用。', '适合持续开发与高频模型调用。', '适合密集任务与更大的用量需求。']
      for (const [index, plan] of DEFAULT_SUBSCRIPTION_PLANS.entries()) {
        // Do not rewrite a sold plan's entitlement; existing customers retain their purchased rules.
        await client.query(
          `UPDATE subscription_plans SET quota_mode = 'usage',
             five_hour_limit_points = COALESCE(daily_limit_usd, $2) * 1000,
             weekly_limit_points = COALESCE(weekly_limit_usd, $3) * 1000,
             monthly_limit_points = COALESCE(monthly_limit_usd, $4) * 1000,
             description = CASE WHEN description = $5 THEN $6 ELSE description END
           WHERE id = $1 AND quota_mode = 'spend'
             AND NOT EXISTS (SELECT 1 FROM user_subscriptions WHERE plan_id = $1)`,
          [plan.id, plan.daily, plan.weekly, plan.monthly, oldDescriptions[index], plan.description],
        )
      }
      await client.query("INSERT INTO settings (key, value) VALUES ('subscription_usage_windows_v1', '1')")
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally { client.release() }
}
