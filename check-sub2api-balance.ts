import { pool } from './src/db/index'
import { fetchSub2ApiBalance, formatBalanceInfo } from './src/providers/sub2api/balance'

async function checkSub2ApiBalances() {
  try {
    console.log('=' .repeat(80))
    console.log('Sub2API 账户余额查询')
    console.log('=' .repeat(80))
    console.log()

    // 获取所有 sub2api 账户
    const accountsResult = await pool.query(`
      SELECT
        id,
        name,
        proxy_url,
        oauth_access_token,
        status
      FROM accounts
      WHERE provider = 'sub2api'
      ORDER BY name
    `)

    if (accountsResult.rows.length === 0) {
      console.log('❌ 未找到 sub2api 账户')
      await pool.end()
      process.exit(0)
    }

    console.log(`找到 ${accountsResult.rows.length} 个 sub2api 账户\n`)

    for (const account of accountsResult.rows) {
      console.log(`--- ${account.name} ---`)
      console.log(`ID: ${account.id}`)
      console.log(`状态: ${account.status}`)
      console.log(`Proxy URL: ${account.proxy_url}`)

      if (!account.oauth_access_token) {
        console.log('❌ 未配置 API Key (oauth_access_token 为空)')
        console.log()
        continue
      }

      if (!account.proxy_url) {
        console.log('❌ 未配置 Proxy URL')
        console.log()
        continue
      }

      console.log('🔍 查询余额中...')

      try {
        const balance = await fetchSub2ApiBalance(
          account.oauth_access_token,
          account.proxy_url
        )

        if (balance) {
          console.log('✅ 余额信息:')
          console.log(`   ${formatBalanceInfo(balance)}`)

          // 显示详细信息
          if (balance.remaining != null) {
            const color = balance.remaining > 5 ? '✅' : balance.remaining > 1 ? '⚠️ ' : '❌'
            console.log(`   ${color} 剩余额度: $${balance.remaining.toFixed(4)}`)
          }

          if (balance.totalBalance != null) {
            console.log(`   💰 总额度: $${balance.totalBalance.toFixed(2)}`)
          }

          if (balance.used != null) {
            console.log(`   📊 已使用: $${balance.used.toFixed(2)}`)
            if (balance.totalBalance != null) {
              const usagePercent = (balance.used / balance.totalBalance * 100).toFixed(1)
              console.log(`   📈 使用率: ${usagePercent}%`)
            }
          }

          if (balance.resetAt) {
            const resetDate = new Date(balance.resetAt)
            console.log(`   🔄 重置时间: ${resetDate.toLocaleString('zh-CN')}`)
          }

          if (balance.hasSubscription) {
            console.log(`   ✅ 订阅状态: 有效`)
          }

          if (balance.planName) {
            console.log(`   📋 订阅计划: ${balance.planName}`)
          }
        } else {
          console.log('⚠️  无法获取余额信息')
          console.log('   可能的原因:')
          console.log('   1. 该 sub2api 端点不支持余额查询')
          console.log('   2. API Key 无效或权限不足')
          console.log('   3. 端点地址配置错误')
        }
      } catch (err: any) {
        console.log(`❌ 查询失败: ${err.message}`)
      }

      console.log()
    }

    console.log('=' .repeat(80))
    console.log('查询完成')
    console.log('=' .repeat(80))
    console.log()
    console.log('提示:')
    console.log('- 如果所有账户都无法获取余额，可能是 sub2api 端点不支持标准的余额查询 API')
    console.log('- 部分 sub2api 服务可能使用自定义的余额查询端点')
    console.log('- 你可以联系 sub2api 服务提供商确认余额查询 API 的地址')

  } catch (err) {
    console.error('查询出错:', err)
  } finally {
    await pool.end()
    process.exit(0)
  }
}

checkSub2ApiBalances()
