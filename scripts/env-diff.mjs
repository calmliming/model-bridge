#!/usr/bin/env node
// 读取当前仓库 .env.local，自动挑出与线上 144.34.169.199 不同的键，
// 打印【键名 + 为什么不同】，绝不打印值。
//
// 用途：拆分本地/线上环境后，检查本地是否漏掉了线上已有的配置项。

import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function parseEnvFile(path) {
  if (!existsSync(path)) return null
  const out = new Map()
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(line)
    if (m) out.set(m[1], m[2].trim())
  }
  return out
}

const local = parseEnvFile(resolve(rootDir, '.env.local'))
const prod = parseEnvFile(resolve(rootDir, '.env'))

if (!local) {
  console.error('[env-diff] 找不到 .env.local')
  process.exit(1)
}
if (!prod) {
  console.warn('[env-diff] 找不到 .env（线上配置通常只在服务器上，本地没有是正常的）')
}

const SECRET_HINTS = /SECRET|KEY|PASSWORD|TOKEN|PRIVATE/i

console.log(`本地 .env.local 共 ${local.size} 个键`)
if (prod) console.log(`本地 .env 共 ${prod.size} 个键（仅作对比参考）`)
console.log('')

if (!prod) process.exit(0)

console.log('键名'.padEnd(38) + '线上'.padEnd(6) + '本地'.padEnd(6) + '本地值状态')
console.log('-'.repeat(78))
for (const key of [...new Set([...prod.keys(), ...local.keys()])].sort()) {
  const p = prod.get(key)
  const l = local.get(key)
  const state = l === undefined ? '缺失' : l === '' ? '空' : SECRET_HINTS.test(key) ? '已设置(secret)' : '已设置'
  const flag = p === undefined ? '仅本地' : l === undefined ? '仅线上 ⚠' : ''
  console.log(key.padEnd(38) + String(p !== undefined).padEnd(6) + String(l !== undefined).padEnd(6) + state + ' ' + flag)
}
