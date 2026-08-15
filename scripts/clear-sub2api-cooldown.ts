#!/usr/bin/env tsx
/**
 * 清除 Sub2API 账户冷却期
 */

import { db } from '../src/db/index.js'
import { accounts } from '../src/db/schema.js'
import { eq } from 'drizzle-orm'

async function clearSub2ApiCooldowns() {
  console.log('🔍 查找处于冷却期的 Sub2API 账户...\n')

  const sub2apiAccounts = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      status: accounts.status,
      cooldownUntil: accounts.cooldownUntil,
    })
    .from(accounts)
    .where(eq(accounts.provider, 'sub2api'))

  if (sub2apiAccounts.length === 0) {
    console.log('❌ 未找到任何 Sub2API 账户')
    return
  }

  const coolingAccounts = sub2apiAccounts.filter(
    acc => acc.cooldownUntil && acc.cooldownUntil > Date.now()
  )

  if (coolingAccounts.length === 0) {
    console.log('✅ 没有账户处于冷却期')
    return
  }

  console.log(`找到 ${coolingAccounts.length} 个处于冷却期的账户：\n`)

  for (const acc of coolingAccounts) {
    const remainingMs = acc.cooldownUntil! - Date.now()
    const remainingSec = Math.ceil(remainingMs / 1000)
    console.log(`   ❄️  ${acc.name} (${acc.id})`)
    console.log(`      状态: ${acc.status}`)
    console.log(`      冷却剩余: ${remainingSec} 秒\n`)
  }

  console.log('🔧 正在清除冷却期...\n')

  await db
    .update(accounts)
    .set({ cooldownUntil: null })
    .where(eq(accounts.provider, 'sub2api'))

  console.log('✅ 已清除所有 Sub2API 账户的冷却期')
  console.log('💡 账户现在可以立即使用\n')
}

clearSub2ApiCooldowns().catch(err => {
  console.error('❌ 操作失败:', err)
  process.exit(1)
})
