#!/usr/bin/env tsx
/**
 * 解除上游账号的限流 / 错误冷却（账号级 + 模型级）。
 *
 * 用法：
 *   npm run fix:cooldown -- --provider deepseek   # 按供应商
 *   npm run fix:cooldown -- --id <accountId>      # 按账号 ID
 *   npm run fix:cooldown -- --all                 # 全部处于冷却的账号
 *   再加 --dry-run 只查看不修改
 *
 * 仅处理 status 为 rate_limited / error 的账号；disabled（凭证失效等永久状态）
 * 一律不动，避免把已经报废的账号误放回调度池。
 */

import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../src/db/index.js'
import { accounts } from '../src/db/schema.js'

const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const provider = flag('provider')
const id = flag('id')
const all = argv.includes('--all')
const dryRun = argv.includes('--dry-run')

if (!provider && !id && !all) {
  console.error('用法: npm run fix:cooldown -- (--provider <name> | --id <accountId> | --all) [--dry-run]')
  process.exit(1)
}

const TRANSIENT = ['rate_limited', 'error'] as const

const scope = id
  ? eq(accounts.id, id)
  : provider
    ? and(eq(accounts.provider, provider), inArray(accounts.status, [...TRANSIENT]))
    : inArray(accounts.status, [...TRANSIENT])

const rows = await db
  .select({
    id: accounts.id,
    name: accounts.name,
    provider: accounts.provider,
    status: accounts.status,
    cooldownUntil: accounts.cooldownUntil,
    metadata: accounts.metadata,
  })
  .from(accounts)
  .where(scope)

const now = Date.now()
const targets = rows.filter((r) => TRANSIENT.includes(r.status as (typeof TRANSIENT)[number]))

if (targets.length === 0) {
  console.log('✅ 没有需要解除冷却的账号')
  process.exit(0)
}

console.log(`找到 ${targets.length} 个处于冷却的账号：\n`)
for (const row of targets) {
  const remain = row.cooldownUntil ? Math.max(0, Math.round((row.cooldownUntil - now) / 1000)) : 0
  console.log(`  ❄️  ${row.provider} / ${row.name} (${row.id})`)
  console.log(`      状态: ${row.status}，冷却剩余: ${remain}s`)
  const cooldowns = (row.metadata as { modelCooldowns?: Record<string, number> } | null)?.modelCooldowns
  for (const [model, until] of Object.entries(cooldowns ?? {})) {
    if (typeof until === 'number' && until > now) {
      console.log(`      模型冷却: ${model} 剩余 ${Math.round((until - now) / 1000)}s`)
    }
  }
}

if (dryRun) {
  console.log('\n(--dry-run，未修改任何数据)')
  process.exit(0)
}

for (const row of targets) {
  await db
    .update(accounts)
    .set({ status: 'active', cooldownUntil: null, metadata: stripModelCooldowns(row.metadata) })
    .where(and(eq(accounts.id, row.id), inArray(accounts.status, [...TRANSIENT])))
}

console.log(`\n✅ 已解除 ${targets.length} 个账号的冷却，立即可被调度`)
process.exit(0)

/** 清掉模型级冷却，其余 metadata 原样保留。 */
function stripModelCooldowns(metadata: unknown): Record<string, unknown> {
  const md = metadata && typeof metadata === 'object' ? { ...(metadata as Record<string, unknown>) } : {}
  delete md.modelCooldowns
  return md
}
