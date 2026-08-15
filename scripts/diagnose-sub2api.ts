#!/usr/bin/env tsx
/**
 * Sub2API 账户诊断工具
 *
 * 检查所有 Sub2API 账户的状态、连接性和余额
 */

import { db } from '../src/db/index.js'
import { accounts } from '../src/db/schema.js'
import { eq } from 'drizzle-orm'
import { decrypt } from '../src/crypto.js'
import { fetchSub2ApiBalance } from '../src/providers/sub2api/balance.js'

interface DiagnosticResult {
  accountId: string
  accountName: string
  status: string
  baseUrl: string | null
  issues: string[]
  balanceInfo?: string
  healthy: boolean
}

async function testConnection(baseUrl: string, apiKey: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = `${baseUrl}/v1/usage`
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` }
    }

    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function diagnoseSub2ApiAccounts(): Promise<DiagnosticResult[]> {
  const sub2apiAccounts = await db
    .select()
    .from(accounts)
    .where(eq(accounts.provider, 'sub2api'))

  if (sub2apiAccounts.length === 0) {
    console.log('❌ 未找到任何 Sub2API 账户')
    return []
  }

  console.log(`\n🔍 找到 ${sub2apiAccounts.length} 个 Sub2API 账户，开始诊断...\n`)

  const results: DiagnosticResult[] = []

  for (const account of sub2apiAccounts) {
    const issues: string[] = []
    let healthy = true

    console.log(`\n📋 检查账户: ${account.name} (${account.id})`)
    console.log(`   状态: ${account.status}`)
    console.log(`   Base URL: ${account.proxyUrl || '未配置'}`)

    // 检查基本配置
    if (!account.proxyUrl) {
      issues.push('❌ 缺少 Base URL 配置')
      healthy = false
    }

    if (!account.oauthAccessToken) {
      issues.push('❌ 缺少 API Key')
      healthy = false
    }

    if (account.status !== 'active') {
      issues.push(`⚠️  账户状态为: ${account.status}`)
      healthy = false
    }

    if (account.cooldownUntil && account.cooldownUntil > Date.now()) {
      const remainingMs = account.cooldownUntil - Date.now()
      const remainingSec = Math.ceil(remainingMs / 1000)
      issues.push(`❄️  账户处于冷却期，剩余 ${remainingSec} 秒`)
      healthy = false
    }

    let balanceInfo: string | undefined

    // 测试连接和余额
    if (account.proxyUrl && account.oauthAccessToken) {
      try {
        const apiKey = decrypt(account.oauthAccessToken)

        console.log('   🔌 测试连接...')
        const connectionTest = await testConnection(account.proxyUrl, apiKey)

        if (connectionTest.ok) {
          console.log('   ✅ 连接成功')

          // 查询余额
          console.log('   💰 查询余额...')
          try {
            const balance = await fetchSub2ApiBalance(apiKey, account.proxyUrl)

            if (balance.unlimited) {
              balanceInfo = '不限额'
              console.log('   ✅ 余额: 不限额')
            } else if (balance.remaining !== undefined) {
              balanceInfo = `剩余 $${balance.remaining.toFixed(2)}`
              console.log(`   ✅ 余额: 剩余 $${balance.remaining.toFixed(2)}`)

              if (balance.remaining <= 0) {
                issues.push('❌ 余额已耗尽')
                healthy = false
              } else if (balance.remaining < 1) {
                issues.push(`⚠️  余额不足: $${balance.remaining.toFixed(2)}`)
              }
            } else {
              balanceInfo = '无法获取余额信息'
              issues.push('⚠️  无法解析余额信息')
            }
          } catch (balanceErr) {
            const errMsg = balanceErr instanceof Error ? balanceErr.message : String(balanceErr)
            balanceInfo = `查询失败: ${errMsg}`
            issues.push(`⚠️  余额查询失败: ${errMsg}`)
            console.log(`   ⚠️  余额查询失败: ${errMsg}`)
          }
        } else {
          issues.push(`❌ 连接失败: ${connectionTest.error}`)
          healthy = false
          console.log(`   ❌ 连接失败: ${connectionTest.error}`)
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        issues.push(`❌ 诊断失败: ${errMsg}`)
        healthy = false
        console.log(`   ❌ 诊断失败: ${errMsg}`)
      }
    }

    results.push({
      accountId: account.id,
      accountName: account.name,
      status: account.status,
      baseUrl: account.proxyUrl,
      issues,
      balanceInfo,
      healthy,
    })
  }

  return results
}

async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log('     Sub2API 账户诊断工具')
  console.log('═══════════════════════════════════════════════════')

  const results = await diagnoseSub2ApiAccounts()

  if (results.length === 0) {
    console.log('\n💡 提示：请先在管理界面添加 Sub2API 账户')
    process.exit(1)
  }

  console.log('\n\n═══════════════════════════════════════════════════')
  console.log('     诊断结果汇总')
  console.log('═══════════════════════════════════════════════════\n')

  const healthyCount = results.filter(r => r.healthy).length
  const unhealthyCount = results.length - healthyCount

  for (const result of results) {
    const statusIcon = result.healthy ? '✅' : '❌'
    console.log(`${statusIcon} ${result.accountName} (${result.accountId})`)
    console.log(`   Base URL: ${result.baseUrl || '未配置'}`)
    if (result.balanceInfo) {
      console.log(`   余额: ${result.balanceInfo}`)
    }
    if (result.issues.length > 0) {
      console.log(`   问题:`)
      result.issues.forEach(issue => console.log(`      ${issue}`))
    }
    console.log()
  }

  console.log('═══════════════════════════════════════════════════')
  console.log(`健康账户: ${healthyCount} / ${results.length}`)
  console.log('═══════════════════════════════════════════════════\n')

  if (unhealthyCount > 0) {
    console.log('⚠️  发现问题，请根据上述信息进行修复：\n')
    console.log('1. 检查 Base URL 配置是否正确')
    console.log('2. 确认 API Key 有效')
    console.log('3. 验证上游服务可访问')
    console.log('4. 检查余额是否充足')
    console.log('5. 等待冷却期结束（如果有）\n')
    process.exit(1)
  } else {
    console.log('✅ 所有 Sub2API 账户运行正常！\n')
    process.exit(0)
  }
}

main().catch((err) => {
  console.error('诊断失败:', err)
  process.exit(1)
})
