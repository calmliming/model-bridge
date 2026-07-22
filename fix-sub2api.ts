import { pool } from './src/db/index'

async function fixSub2apiAccounts() {
  try {
    console.log('开始修复 sub2api 账户配置...\n')

    // 1. 先测试每个账户的连通性
    console.log('步骤 1: 检查账户状态')
    console.log('=' .repeat(80))

    const accounts = await pool.query(`
      SELECT id, name, proxy_url, weight, status
      FROM accounts
      WHERE provider = 'sub2api'
      ORDER BY name
    `)

    console.log(`找到 ${accounts.rows.length} 个 sub2api 账户：\n`)
    accounts.rows.forEach((acc: any) => {
      console.log(`- ${acc.name}`)
      console.log(`  ID: ${acc.id}`)
      console.log(`  Proxy URL: ${acc.proxy_url}`)
      console.log(`  权重: ${acc.weight}`)
      console.log(`  状态: ${acc.status}`)
      console.log()
    })

    // 2. 平衡权重 - 让所有账户有相同的机会被选中
    console.log('\n步骤 2: 平衡账户权重')
    console.log('=' .repeat(80))

    console.log('将所有 sub2api 账户权重设置为 1，确保平均分配负载...')

    await pool.query(`
      UPDATE accounts
      SET weight = 1
      WHERE provider = 'sub2api'
    `)

    console.log('✅ 权重已平衡\n')

    // 3. 清除所有 sub2api 账户的冷却状态
    console.log('步骤 3: 清除账户冷却状态')
    console.log('=' .repeat(80))

    const clearResult = await pool.query(`
      UPDATE accounts
      SET status = 'active', cooldown_until = NULL
      WHERE provider = 'sub2api'
        AND status IN ('error', 'rate_limited')
      RETURNING id, name
    `)

    if (clearResult.rows.length > 0) {
      console.log(`已清除 ${clearResult.rows.length} 个账户的冷却状态：`)
      clearResult.rows.forEach((acc: any) => {
        console.log(`  - ${acc.name}`)
      })
    } else {
      console.log('✅ 所有账户都处于 active 状态\n')
    }

    // 4. 检查分组成员关系
    console.log('\n步骤 4: 验证分组成员关系')
    console.log('=' .repeat(80))

    const members = await pool.query(`
      SELECT
        a.name as account_name,
        ag.name as group_name,
        agm.weight as member_weight
      FROM account_group_members agm
      JOIN accounts a ON agm.account_id = a.id
      JOIN account_groups ag ON agm.group_id = ag.id
      WHERE a.provider = 'sub2api'
    `)

    if (members.rows.length > 0) {
      console.log(`✅ 找到 ${members.rows.length} 个分组成员关系：\n`)
      members.rows.forEach((m: any) => {
        console.log(`  - ${m.account_name} → ${m.group_name}`)
      })
    } else {
      console.log('❌ 警告：未找到分组成员关系！')
    }

    // 5. 检查最近使用情况
    console.log('\n步骤 5: 检查最近的使用分布')
    console.log('=' .repeat(80))

    const usageStats = await pool.query(`
      SELECT
        a.name as account_name,
        COUNT(*) as total_requests,
        SUM(CASE WHEN ul.status = 'success' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN ul.status = 'error' THEN 1 ELSE 0 END) as error_count,
        MAX(to_timestamp(ul.ts/1000)) as last_used
      FROM usage_logs ul
      JOIN accounts a ON ul.account_id = a.id
      WHERE a.provider = 'sub2api'
        AND ul.ts > EXTRACT(EPOCH FROM NOW() - INTERVAL '1 hour') * 1000
      GROUP BY a.name
      ORDER BY last_used DESC
    `)

    if (usageStats.rows.length > 0) {
      console.log('最近 1 小时的使用情况：\n')
      usageStats.rows.forEach((stat: any) => {
        console.log(`  ${stat.account_name}:`)
        console.log(`    总请求: ${stat.total_requests}`)
        console.log(`    成功: ${stat.success_count}`)
        console.log(`    失败: ${stat.error_count}`)
        console.log(`    最后使用: ${stat.last_used}`)
        console.log()
      })
    } else {
      console.log('最近 1 小时无使用记录\n')
    }

    // 6. 验证修复结果
    console.log('\n步骤 6: 验证修复结果')
    console.log('=' .repeat(80))

    const finalCheck = await pool.query(`
      SELECT
        a.id,
        a.name,
        a.status,
        a.weight,
        a.cooldown_until,
        COUNT(agm.group_id) as group_count
      FROM accounts a
      LEFT JOIN account_group_members agm ON a.id = agm.account_id
      WHERE a.provider = 'sub2api'
      GROUP BY a.id, a.name, a.status, a.weight, a.cooldown_until
      ORDER BY a.name
    `)

    console.log('当前状态：\n')
    let allGood = true

    finalCheck.rows.forEach((acc: any) => {
      const issues = []
      if (acc.status !== 'active') issues.push(`状态异常: ${acc.status}`)
      if (acc.cooldown_until) issues.push('有冷却时间')
      if (acc.group_count === 0) issues.push('未加入分组')

      const statusIcon = issues.length === 0 ? '✅' : '⚠️ '

      console.log(`${statusIcon} ${acc.name}`)
      console.log(`    权重: ${acc.weight}`)
      console.log(`    状态: ${acc.status}`)
      console.log(`    分组数: ${acc.group_count}`)

      if (issues.length > 0) {
        console.log(`    问题: ${issues.join(', ')}`)
        allGood = false
      }
      console.log()
    })

    console.log('=' .repeat(80))

    if (allGood) {
      console.log('\n🎉 修复完成！所有账户配置正常。')
      console.log('\n建议：')
      console.log('1. 现在可以测试 API 调用，系统会在三个账户间轮换')
      console.log('2. 如果仍有错误，请检查 proxy_url 端点的认证配置')
      console.log('3. 查看管理后台的使用记录，确认账户轮换是否生效')
    } else {
      console.log('\n⚠️  修复完成，但发现一些需要注意的问题，请查看上方详情。')
    }

  } catch (err) {
    console.error('\n❌ 修复过程出错:', err)
  } finally {
    await pool.end()
    process.exit(0)
  }
}

fixSub2apiAccounts()
