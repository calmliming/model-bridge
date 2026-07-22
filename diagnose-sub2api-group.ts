import { pool } from './src/db/index'

async function diagnose() {
  try {
    console.log('='.repeat(80))
    console.log('Sub2API 分组问题诊断报告')
    console.log('='.repeat(80))
    console.log()

    // 1. 检查所有 sub2api 账户的基本信息
    console.log('1. Sub2API 账户基本信息：')
    console.log('-'.repeat(80))
    const accountsResult = await pool.query(`
      SELECT
        id,
        name,
        provider,
        status,
        cooldown_until,
        to_timestamp(cooldown_until/1000) as cooldown_until_time,
        group_id as deprecated_group_id,
        proxy_url,
        weight,
        concurrency_limit,
        last_used_at,
        to_timestamp(last_used_at/1000) as last_used_time
      FROM accounts
      WHERE provider = 'sub2api'
      ORDER BY name
    `)

    if (accountsResult.rows.length === 0) {
      console.log('❌ 未找到任何 sub2api 账户')
    } else {
      accountsResult.rows.forEach((row: any, i: number) => {
        console.log(`\n账户 ${i + 1}: ${row.name} (${row.id})`)
        console.log(`  状态: ${row.status}`)
        console.log(`  代理URL: ${row.proxy_url || '未配置'}`)
        console.log(`  权重: ${row.weight}`)
        console.log(`  并发限制: ${row.concurrency_limit || '无限制'}`)
        console.log(`  冷却至: ${row.cooldown_until ? row.cooldown_until_time : '无'}`)
        console.log(`  最后使用: ${row.last_used_at ? row.last_used_time : '从未使用'}`)
        console.log(`  旧版分组ID: ${row.deprecated_group_id || '无'}`)
      })
    }

    // 2. 检查账户分组
    console.log('\n\n2. 账户分组信息：')
    console.log('-'.repeat(80))
    const groupsResult = await pool.query(`
      SELECT
        id,
        name,
        description,
        rate_multiplier,
        to_timestamp(created_at/1000) as created_time
      FROM account_groups
      ORDER BY name
    `)

    if (groupsResult.rows.length === 0) {
      console.log('❌ 未找到任何账户分组')
    } else {
      groupsResult.rows.forEach((row: any) => {
        console.log(`\n分组: ${row.name} (${row.id})`)
        console.log(`  描述: ${row.description || '无'}`)
        console.log(`  费率乘数: ${row.rate_multiplier}`)
        console.log(`  创建时间: ${row.created_time}`)
      })
    }

    // 3. 检查分组成员关系
    console.log('\n\n3. Sub2API 账户的分组成员关系：')
    console.log('-'.repeat(80))
    const membersResult = await pool.query(`
      SELECT
        agm.account_id,
        a.name as account_name,
        agm.group_id,
        ag.name as group_name,
        agm.weight as member_weight,
        a.weight as account_weight,
        COALESCE(agm.weight, a.weight) as effective_weight,
        to_timestamp(agm.created_at/1000) as member_since
      FROM account_group_members agm
      INNER JOIN accounts a ON agm.account_id = a.id
      INNER JOIN account_groups ag ON agm.group_id = ag.id
      WHERE a.provider = 'sub2api'
      ORDER BY ag.name, a.name
    `)

    if (membersResult.rows.length === 0) {
      console.log('❌ 未找到任何 sub2api 账户的分组成员关系')
      console.log('   这可能是问题的根本原因！')
    } else {
      let currentGroup = ''
      membersResult.rows.forEach((row: any) => {
        if (row.group_name !== currentGroup) {
          currentGroup = row.group_name
          console.log(`\n📁 分组: ${row.group_name} (${row.group_id})`)
        }
        console.log(`  └─ ${row.account_name}`)
        console.log(`     成员权重: ${row.member_weight || '继承'} | 账户权重: ${row.account_weight} | 有效权重: ${row.effective_weight}`)
        console.log(`     加入时间: ${row.member_since}`)
      })
    }

    // 4. 检查 API Keys 的分组绑定
    console.log('\n\n4. API Keys 的分组绑定：')
    console.log('-'.repeat(80))
    const keysResult = await pool.query(`
      SELECT
        ak.id,
        ak.name,
        ak.key_prefix,
        ak.enabled,
        ak.user_id,
        u.email as user_email,
        ak.account_group_id,
        ag.name as group_name,
        to_timestamp(ak.created_at/1000) as created_time,
        to_timestamp(ak.last_used_at/1000) as last_used_time
      FROM api_keys ak
      LEFT JOIN users u ON ak.user_id = u.id
      LEFT JOIN account_groups ag ON ak.account_group_id = ag.id
      WHERE ak.enabled = true
      ORDER BY ak.created_at DESC
    `)

    if (keysResult.rows.length === 0) {
      console.log('❌ 未找到任何启用的 API Key')
    } else {
      keysResult.rows.forEach((row: any, i: number) => {
        console.log(`\nAPI Key ${i + 1}: ${row.name} (${row.key_prefix}...)`)
        console.log(`  用户: ${row.user_email || '系统'}`)
        console.log(`  绑定分组: ${row.group_name || '默认池（无分组）'}`)
        console.log(`  创建时间: ${row.created_time}`)
        console.log(`  最后使用: ${row.last_used_time || '从未使用'}`)
      })
    }

    // 5. 检查最近的错误日志
    console.log('\n\n5. 最近的错误日志（最新3条）：')
    console.log('-'.repeat(80))
    const errorsResult = await pool.query(`
      SELECT
        ul.id,
        to_timestamp(ul.ts/1000) as time,
        ul.provider,
        ul.model,
        ul.status,
        ul.account_id,
        a.name as account_name,
        ul.user_id,
        u.email as user_email,
        ul.api_key_id,
        ak.name as api_key_name,
        ul.latency_ms,
        LEFT(ul.request_input, 200) as request_preview
      FROM usage_logs ul
      LEFT JOIN accounts a ON ul.account_id = a.id
      LEFT JOIN users u ON ul.user_id = u.id
      LEFT JOIN api_keys ak ON ul.api_key_id = ak.id
      WHERE ul.status != 'success'
      ORDER BY ul.ts DESC
      LIMIT 3
    `)

    if (errorsResult.rows.length === 0) {
      console.log('✅ 没有找到错误记录')
    } else {
      errorsResult.rows.forEach((row: any, i: number) => {
        console.log(`\n❌ 错误 ${i + 1}:`)
        console.log(`  时间: ${row.time}`)
        console.log(`  Provider: ${row.provider}`)
        console.log(`  Model: ${row.model}`)
        console.log(`  状态: ${row.status}`)
        console.log(`  账户: ${row.account_name || row.account_id || '未知'}`)
        console.log(`  用户: ${row.user_email || row.user_id || '未知'}`)
        console.log(`  API Key: ${row.api_key_name || row.api_key_id || '未知'}`)
        console.log(`  延迟: ${row.latency_ms || 'N/A'} ms`)
        if (row.request_preview) {
          console.log(`  请求预览: ${row.request_preview}...`)
        }
      })
    }

    // 6. 检查分组中有 sub2api 账户但 API Key 未绑定的情况
    console.log('\n\n6. 潜在配置问题检查：')
    console.log('-'.repeat(80))

    const orphanedAccounts = await pool.query(`
      SELECT
        a.id,
        a.name,
        a.status
      FROM accounts a
      WHERE a.provider = 'sub2api'
        AND a.status != 'disabled'
        AND NOT EXISTS (
          SELECT 1 FROM account_group_members agm
          WHERE agm.account_id = a.id
        )
    `)

    if (orphanedAccounts.rows.length > 0) {
      console.log(`\n⚠️  发现 ${orphanedAccounts.rows.length} 个未加入任何分组的 sub2api 账户：`)
      orphanedAccounts.rows.forEach((row: any) => {
        console.log(`  - ${row.name} (${row.id}): ${row.status}`)
      })
      console.log('  提示：如果这些账户应该在某个分组中，需要添加到 account_group_members 表')
    } else {
      console.log('\n✅ 所有 sub2api 账户都已加入分组')
    }

    // 检查是否有账户在冷却中
    const coolingAccounts = await pool.query(`
      SELECT
        id,
        name,
        status,
        to_timestamp(cooldown_until/1000) as cooldown_until_time,
        CASE
          WHEN cooldown_until > EXTRACT(EPOCH FROM NOW()) * 1000
          THEN ROUND((cooldown_until - EXTRACT(EPOCH FROM NOW()) * 1000) / 1000)
          ELSE 0
        END as remaining_seconds
      FROM accounts
      WHERE provider = 'sub2api'
        AND cooldown_until IS NOT NULL
        AND cooldown_until > EXTRACT(EPOCH FROM NOW()) * 1000
    `)

    if (coolingAccounts.rows.length > 0) {
      console.log(`\n⚠️  发现 ${coolingAccounts.rows.length} 个正在冷却的 sub2api 账户：`)
      coolingAccounts.rows.forEach((row: any) => {
        console.log(`  - ${row.name}: ${row.status}, 冷却至 ${row.cooldown_until_time} (剩余 ${row.remaining_seconds} 秒)`)
      })
    } else {
      console.log('\n✅ 没有账户在冷却中')
    }

    console.log('\n' + '='.repeat(80))
    console.log('诊断完成')
    console.log('='.repeat(80))

  } catch (err: any) {
    console.error('\n❌ 诊断过程中出错:', err.message)
    if (err.code === 'ECONNREFUSED') {
      console.error('\n提示：请先启动 PostgreSQL 数据库')
      console.error('运行命令: docker compose up -d postgres')
    }
  } finally {
    await pool.end()
    process.exit(0)
  }
}

diagnose()
