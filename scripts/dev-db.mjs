#!/usr/bin/env node
// 本地开发用的 PostgreSQL 容器管理脚本。
//
//   npm run dev:db        起库（后台，幂等）
//   npm run dev:db:down   停库（保留数据卷）
//   npm run dev:db:reset  停库并删除数据卷（彻底重来）
//
// 用的是 docker-compose.dev.yml：项目名 model-bridge-dev、端口 5433、
// 数据卷 ./data/dev-pg，与线上 docker-compose.yml 完全隔离。

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const COMPOSE_FILE = 'docker-compose.dev.yml'
const PROJECT_NAME = 'model-bridge-dev'
const CONTAINER_NAME = 'model-bridge-dev-postgres'
const DEV_DB_PORT = 5433

const action = (process.argv[2] ?? 'up').toLowerCase()
if (!['up', 'down', 'reset'].includes(action)) {
  console.error(`[dev:db] 未知参数 "${action}"，可用：up | down | reset`)
  process.exit(1)
}

function run(args, { capture = false } = {}) {
  const result = spawnSync('docker', args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    // 不经 shell 传参：避免参数拼接带来的转义问题（Node 对此有弃用告警）。
    // docker.exe 在 Windows 上可被直接解析，无需 shell。
    shell: false,
    windowsHide: true,
  })
  return result
}

function compose(args, options) {
  return run(['compose', '-p', PROJECT_NAME, '-f', COMPOSE_FILE, ...args], options)
}

function fail(message) {
  console.error(`[dev:db] ${message}`)
  process.exit(1)
}

/**
 * 等 PostgreSQL 真正接受连接。
 *
 * 容器 healthy 不等于数据库可用：崩溃恢复或刚初始化时 pg_isready 会返回
 * "rejecting connections"，此时后端连上去只会拿到 57P03
 * "the database system is starting up"，而 src/db/ready.ts 只重试 5 次就
 * 放弃，后端直接 FATAL 退出。所以在交棒给 dev:all 之前必须确认这一点。
 */
async function waitForAcceptingConnections(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  let lastOutput = ''
  while (Date.now() < deadline) {
    const probe = run(
      ['exec', CONTAINER_NAME, 'pg_isready', '-U', 'model_bridge', '-d', 'model_bridge'],
      { capture: true },
    )
    lastOutput = `${probe.stdout ?? ''}${probe.stderr ?? ''}`.trim()
    if (probe.status === 0) return true
    await new Promise((r) => setTimeout(r, 1500))
  }
  if (lastOutput) console.error(`[dev:db] 最后一次探测输出：${lastOutput}`)
  return false
}

// ── 前置检查：Docker 必须可用 ────────────────────────────────
const daemon = run(['info', '--format', '{{.ServerVersion}}'], { capture: true })
if (daemon.status !== 0) {
  console.error('[dev:db] 连不上 Docker 守护进程。')
  console.error('')
  console.error('  请先启动 Docker Desktop（开始菜单搜索 "Docker Desktop"），')
  console.error('  等右下角鲸鱼图标变绿后重新执行本命令。')
  console.error('')
  console.error('  如果不想用容器：本地自建 PostgreSQL 后，把 .env.local 的')
  console.error(`  DATABASE_URL 指向它（端口不一定要 ${DEV_DB_PORT}）即可。`)
  process.exit(1)
}

// ── 前置检查：本地配置必须存在且指向本地库 ──────────────────
if (action === 'up') {
  if (!existsSync(resolve(rootDir, '.env.local'))) {
    console.warn('[dev:db] 警告：.env.local 不存在，后端可能读到线上 .env —— 请先创建本地配置。')
  }
  if (existsSync(resolve(rootDir, '.env'))) {
    console.warn('[dev:db] 提示：仓库根目录存在 .env（线上配置）。本脚本不会读取它。')
  }
}

// ── 执行 ─────────────────────────────────────────────────────
if (action === 'up') {
  console.log(`[dev:db] 启动本地 PostgreSQL（项目 ${PROJECT_NAME}，127.0.0.1:${DEV_DB_PORT}）…`)
  const result = compose(['up', '-d', '--wait'])
  if (result.status !== 0) {
    fail('启动失败，请查看上面的 docker 输出。')
  }

  // --wait 只保证容器 healthy，但 PostgreSQL 在崩溃恢复期间仍会拒绝连接
  // （57P03 "the database system is starting up"）。后端启动只重试 5 次就
  // FATAL 退出，所以这里必须等到它真的能接受连接再交棒。
  console.log(`[dev:db] 等待 PostgreSQL 接受连接（端口 ${DEV_DB_PORT}）…`)
  if (!(await waitForAcceptingConnections())) {
    fail('数据库容器已启动，但 60 秒内仍拒绝连接。可尝试 npm run dev:db:reset 重建。')
  }

  console.log('')
  console.log(`[dev:db] 就绪 → postgresql://model_bridge:devpassword@127.0.0.1:${DEV_DB_PORT}/model_bridge`)
  console.log('[dev:db] 接下来：npm run dev:all')
} else {
  const args = action === 'reset' ? ['down', '-v'] : ['down']
  const result = compose(args)
  if (result.status !== 0) {
    fail('停止失败，请查看上面的 docker 输出。')
  }
  console.log(action === 'reset'
    ? '[dev:db] 已停止并删除数据卷（下次 up 会得到全新的空库）。'
    : '[dev:db] 已停止，数据卷保留。')
}
