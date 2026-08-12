#!/usr/bin/env tsx
/**
 * 查询数据库中的所有账户配置
 * 用于诊断 Codex 503 错误
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { config as loadDotenv } from 'dotenv'
import { accounts } from '../src/db/schema.js'
import { sql } from 'drizzle-orm'

loadDotenv()

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('错误：未设置 DATABASE_URL 环境变量')
  console.error('请在 .env 文件中添加：')
  console.error('DATABASE_URL=postgresql://user:password@localhost:5432/model_bridge')
  process.exit(1)
}

const client = postgres(DATABASE_URL)
const db = drizzle(client)

async function checkAccounts() {
  console.log('='.repeat(80))
  console.log('Model-bridge 账户配置检查')
  console.log('='.repeat(80))
  console.log()

  try {
    // 查询所有账户
    const allAccounts = await db
      .select({
        id: accounts.id,
        provider: accounts.provider,
        name: accounts.name,
        status: accounts.status,
        weight: accounts.weight,
        concurrencyLimit: accounts.concurrencyLimit,
        groupId: accounts.groupId,
        cooldownUntil: accounts.cooldownUntil,
        lastUsedAt: accounts.lastUsedAt,
        proxyUrl: accounts.proxyUrl,
        notes: accounts.notes,
      })
      .from(accounts)
      .orderBy(accounts.provider, accounts.name)

    if (allAccounts.length === 0) {
      console.log('⚠️  数据库中没有任何账户配置！')
      console.log()
      console.log('这就是为什么 Codex 会返回 "no sub2api account configured" 错误。')
      console.log()
      console.log('请通过以下方式之一添加账户：')
      console.log('  1. 使用 Web 管理面板')
      console.log('  2. 使用 API 导入')
      console.log('  3. 参考 docs/account-import-example.json')
      console.log()
      return
    }

    console.log(`找到 ${allAccounts.length} 个账户：`)
    console.log()

    // 按 provider 分组统计
    const providerStats = new Map<string, number>()
    for (const account of allAccounts) {
      providerStats.set(account.provider, (providerStats.get(account.provider) || 0) + 1)
    }

    console.log('Provider 统计：')
    for (const [provider, count] of Array.from(providerStats.entries()).sort()) {
      const icon = provider === 'sub2api' ? '✓' : '○'
      console.log(`  ${icon} ${provider}: ${count} 个账户`)
    }
    console.log()

    // 详细列表
    console.log('账户详情：')
    console.log('-'.repeat(80))
    console.log()

    for (const account of allAccounts) {
      const statusIcon = account.status === 'active' ? '✓' : '✗'
      const cooldown = account.cooldownUntil && account.cooldownUntil > Date.now()
        ? ` (冷却至 ${new Date(account.cooldownUntil).toLocaleString('zh-CN')})`
        : ''

      console.log(`${statusIcon} [${account.provider}] ${account.name}`)
      console.log(`   ID: ${account.id}`)
      console.log(`   状态: ${account.status}${cooldown}`)
      console.log(`   权重: ${account.weight} | 并发限制: ${account.concurrencyLimit ?? '无限制'}`)
      if (account.groupId) {
        console.log(`   账户组: ${account.groupId}`)
      }
      if (account.proxyUrl) {
        console.log(`   代理 URL: ${account.proxyUrl}`)
      }
      if (account.lastUsedAt) {
        console.log(`   最后使用: ${new Date(account.lastUsedAt).toLocaleString('zh-CN')}`)
      }
      if (account.notes) {
        console.log(`   备注: ${account.notes}`)
      }
      console.log()
    }

    // 检查 sub2api
    const sub2apiAccounts = allAccounts.filter(a => a.provider === 'sub2api')
    const activeCount = allAccounts.filter(a => a.status === 'active').length

    console.log('='.repeat(80))
    console.log('诊断结果：')
    console.log('='.repeat(80))
    console.log()

    if (sub2apiAccounts.length === 0) {
      console.log('❌ 问题确认：没有 sub2api 账户')
      console.log()
      console.log('Codex 请求 /responses 端点时会路由到 sub2api-responses provider，')
      console.log('但数据库中没有任何 provider="sub2api" 的账户。')
      console.log()
      console.log('解决方案：')
      console.log('  1. 如果你有 Sub2API 服务，添加 sub2api 账户')
      console.log('  2. 如果你想使用其他 provider，修改 Codex 配置使用不同的端点：')
      for (const [provider] of providerStats) {
        if (provider === 'claude') console.log('     - Claude: /v1/messages')
        if (provider === 'openai') console.log('     - OpenAI: /v1/chat/completions')
        if (provider === 'gemini') console.log('     - Gemini: /v1/messages')
        if (provider === 'deepseek') console.log('     - DeepSeek: /v1/messages 或 /deepseek/responses')
        if (provider === 'xiaomi') console.log('     - Xiaomi: /v1/messages')
      }
    } else if (sub2apiAccounts.every(a => a.status !== 'active')) {
      console.log('❌ 问题确认：所有 sub2api 账户都处于非活动状态')
      console.log()
      console.log('虽然有 sub2api 账户，但它们的状态都不是 "active"：')
      for (const account of sub2apiAccounts) {
        console.log(`  - ${account.name}: ${account.status}`)
      }
      console.log()
      console.log('解决方案：在管理面板中启用这些账户')
    } else {
      console.log('✓ 找到可用的 sub2api 账户')
      console.log()
      console.log('活跃的 sub2api 账户：')
      for (const account of sub2apiAccounts.filter(a => a.status === 'active')) {
        console.log(`  - ${account.name}`)
        if (!account.proxyUrl) {
          console.log('    ⚠️  警告：未设置 proxyUrl，请在管理面板中配置')
        }
      }
      console.log()
      console.log('如果 Codex 仍然报错，请检查：')
      console.log('  1. API Key 的 allowed_providers 配置')
      console.log('  2. 账户的 proxyUrl 是否正确')
      console.log('  3. Sub2API 服务是否正常运行')
    }

    console.log()
    console.log(`总计：${allAccounts.length} 个账户 | ${activeCount} 个活跃`)
    console.log()

  } catch (error) {
    console.error('查询失败：', error)
    if (error instanceof Error) {
      console.error('详细信息：', error.message)
    }
    process.exit(1)
  } finally {
    await client.end()
  }
}

checkAccounts().catch(console.error)
