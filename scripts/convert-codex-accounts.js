#!/usr/bin/env node
/**
 * 将 Codex 格式的账号文件批量转换为 model-bridge 导入格式
 *
 * 使用方法：
 *   node scripts/convert-codex-accounts.js <输入目录> [输出文件]
 *
 * 示例：
 *   node scripts/convert-codex-accounts.js ~/codex-accounts output.json
 */

const fs = require('fs')
const path = require('path')

function convertCodexAccount(codexData, filename) {
  // 从 email 或文件名提取账号名称
  const name = codexData.email || filename.replace(/\.json$/, '')

  // Codex 的 access_token 就是 model-bridge 需要的 accessToken
  const accessToken = codexData.access_token
  const refreshToken = codexData.refresh_token

  // 解析 JWT 获取过期时间
  let expiresAt = null
  if (accessToken) {
    try {
      const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString())
      if (payload.exp) {
        expiresAt = payload.exp * 1000 // 转换为毫秒
      }
    } catch (e) {
      console.warn(`⚠️  无法解析 ${filename} 的 JWT，跳过过期时间`)
    }
  }

  const account = {
    provider: 'openai',
    name: name,
    accessToken: accessToken,
  }

  if (refreshToken) {
    account.refreshToken = refreshToken
  }

  if (expiresAt) {
    account.expiresAt = expiresAt
  }

  return account
}

function main() {
  const args = process.argv.slice(2)

  if (args.length < 1) {
    console.error('使用方法: node convert-codex-accounts.js <输入目录> [输出文件]')
    console.error('')
    console.error('示例:')
    console.error('  node scripts/convert-codex-accounts.js ~/codex-accounts')
    console.error('  node scripts/convert-codex-accounts.js ~/codex-accounts output.json')
    process.exit(1)
  }

  const inputDir = args[0]
  const outputFile = args[1] || 'accounts-import.json'

  if (!fs.existsSync(inputDir)) {
    console.error(`❌ 输入目录不存在: ${inputDir}`)
    process.exit(1)
  }

  if (!fs.statSync(inputDir).isDirectory()) {
    console.error(`❌ ${inputDir} 不是一个目录`)
    process.exit(1)
  }

  console.log(`📂 读取目录: ${inputDir}`)

  const files = fs.readdirSync(inputDir)
    .filter(f => f.endsWith('.json'))
    .sort()

  if (files.length === 0) {
    console.error(`❌ 目录中没有找到 .json 文件`)
    process.exit(1)
  }

  console.log(`📄 找到 ${files.length} 个 JSON 文件`)
  console.log('')

  const accounts = []
  const errors = []

  for (const file of files) {
    const filePath = path.join(inputDir, file)

    try {
      const content = fs.readFileSync(filePath, 'utf8')
      const codexData = JSON.parse(content)

      // 验证是否是 Codex 格式
      if (!codexData.access_token) {
        errors.push({ file, error: '缺少 access_token 字段' })
        console.log(`⚠️  ${file}: 缺少 access_token，跳过`)
        continue
      }

      const account = convertCodexAccount(codexData, file)
      accounts.push(account)

      console.log(`✅ ${file} -> ${account.name}`)

    } catch (e) {
      errors.push({ file, error: e.message })
      console.log(`❌ ${file}: ${e.message}`)
    }
  }

  console.log('')
  console.log(`✅ 成功转换: ${accounts.length} 个账号`)
  if (errors.length > 0) {
    console.log(`⚠️  失败: ${errors.length} 个文件`)
  }

  if (accounts.length === 0) {
    console.error('❌ 没有成功转换任何账号')
    process.exit(1)
  }

  // 生成导入文件
  const importData = {
    accounts: accounts
  }

  const outputPath = path.isAbsolute(outputFile) ? outputFile : path.join(process.cwd(), outputFile)
  fs.writeFileSync(outputPath, JSON.stringify(importData, null, 2), 'utf8')

  console.log('')
  console.log(`💾 已保存到: ${outputPath}`)
  console.log('')
  console.log('📋 下一步:')
  console.log('1. 在浏览器打开 model-bridge 管理后台')
  console.log('2. 进入「账号管理」页面')
  console.log('3. 点击「批量导入」按钮')
  console.log(`4. 选择文件: ${outputPath}`)
  console.log('5. 开始导入')

  if (errors.length > 0) {
    console.log('')
    console.log('⚠️  以下文件转换失败:')
    errors.forEach(({ file, error }) => {
      console.log(`   - ${file}: ${error}`)
    })
  }
}

main()
