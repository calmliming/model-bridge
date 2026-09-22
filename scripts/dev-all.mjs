#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const npmCli = process.platform === 'win32' ? process.env.npm_execpath : undefined
const npmCommand = npmCli ? process.execPath : process.platform === 'win32' ? 'cmd.exe' : 'npm'
const npmArgsPrefix = npmCli ? [npmCli] : process.platform === 'win32' ? ['/d', '/s', '/c', 'npm'] : []
const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined

/**
 * 读取本地开发用的环境文件，只为了拿到后端端口。
 *
 * 为什么需要这一步：后端走 .env.local（src/config.ts 里的 APP_ENV=local），
 * 但 Vite 只从 web/ 目录加载自己的 .env 文件，读不到仓库根目录的 .env.local。
 * 把 PORT 透传给前端进程后，web/vite.config.ts 就能用它拼出正确的代理目标。
 * （已确认 Vite 不使用 process.env.PORT 决定自身端口，故不会与 5173 冲突。）
 */
function readLocalPort() {
  const candidates = ['.env.local', '.env']
  for (const name of candidates) {
    let raw
    try {
      raw = readFileSync(resolve(rootDir, name), 'utf8')
    } catch {
      continue
    }
    for (const line of raw.split(/\r?\n/u)) {
      const match = /^\s*PORT\s*=\s*(\d+)\s*$/u.exec(line)
      if (match) return match[1]
    }
  }
  return null
}

const backendPort = readLocalPort()

const ansi = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  magenta: '\x1b[35m',
}

const services = [
  {
    name: 'backend',
    label: 'API',
    color: ansi.blue,
    cwd: rootDir,
    command: npmCommand,
    args: [...npmArgsPrefix, 'run', '--silent', 'dev'],
    // Frontend only starts once the API logs that it is listening.
    readyPattern: /Server listening at/iu,
    // Fallback so the frontend still boots if the ready log never appears.
    // 60s 而不是 20s：后端冷启动实测约 15s，内存紧张（本机 16GB 常被
    // Docker/其它进程占满）时会明显更久，20s 会误报"未就绪"。
    readyTimeoutMs: 60000,
  },
  {
    name: 'frontend',
    label: 'WEB',
    color: ansi.green,
    cwd: resolve(rootDir, 'web'),
    command: npmCommand,
    args: [...npmArgsPrefix, 'run', '--silent', 'dev'],
    // Vite 读不到根目录的 .env.local，这里把后端端口显式传下去，
    // 供 web/vite.config.ts 决定 /api 与 /health 的代理目标。
    env: backendPort ? { PORT: backendPort } : {},
  },
]

const children = new Map()
let shuttingDown = false

function color(text, code) {
  return useColor ? `${code}${text}${ansi.reset}` : text
}

function timestamp() {
  return new Date().toLocaleTimeString('en-GB', { hour12: false })
}

function levelName(level) {
  if (typeof level !== 'number') return 'log'
  if (level >= 60) return 'fatal'
  if (level >= 50) return 'error'
  if (level >= 40) return 'warn'
  if (level >= 30) return 'info'
  if (level >= 20) return 'debug'
  return 'trace'
}

function levelColor(level) {
  if (level === 'fatal' || level === 'error') return ansi.red
  if (level === 'warn') return ansi.yellow
  if (level === 'debug' || level === 'trace') return ansi.magenta
  return ansi.cyan
}

function formatBackendJson(line) {
  if (!line.startsWith('{')) return line

  try {
    const log = JSON.parse(line)
    const level = levelName(log.level)
    const parts = [color(level.padEnd(5), levelColor(level))]

    if (log.req) {
      parts.push(`${log.req.method ?? 'REQ'} ${log.req.url ?? ''}`.trim())
    }

    if (log.res) {
      parts.push(`status=${log.res.statusCode}`)
    }

    if (typeof log.responseTime === 'number') {
      parts.push(`${Math.round(log.responseTime)}ms`)
    }

    if (log.msg) {
      parts.push(log.msg)
    }

    if (log.err) {
      const err = log.err.message ?? log.err.type ?? JSON.stringify(log.err)
      parts.push(color(err, ansi.red))
    }

    return parts.join('  ')
  } catch {
    return line
  }
}

function formatLine(service, line) {
  const cleanLine = line.replace(/\s+$/u, '')
  if (!cleanLine) return ''

  const body = service.name === 'backend' ? formatBackendJson(cleanLine) : cleanLine
  const time = color(timestamp(), ansi.dim)
  const label = color(service.label.padEnd(3), service.color)
  return `${time} ${label} ${body}`
}

function pipeLines(service, stream, writer, onLine) {
  let pending = ''

  stream.on('data', (chunk) => {
    pending += chunk.toString()
    const lines = pending.split(/\r?\n/u)
    pending = lines.pop() ?? ''

    for (const line of lines) {
      if (onLine) onLine(line)
      const formatted = formatLine(service, line)
      if (formatted) writer.write(`${formatted}\n`)
    }
  })

  stream.on('end', () => {
    if (onLine && pending) onLine(pending)
    const formatted = formatLine(service, pending)
    if (formatted) writer.write(`${formatted}\n`)
  })
}

function stopAll(signal = 'SIGTERM') {
  if (shuttingDown) return
  shuttingDown = true

  for (const child of children.values()) {
    if (!child.killed) child.kill(signal)
  }
}

async function startService(service) {
  // 就绪用显式状态位 + 轮询表达，而不是 Promise.race：
  // race 的语义（哪一支先 settle）在调试时很难看清，之前出现过
  // 明明日志里有 "Server listening at" 却仍走超时分支的情况。
  let ready = false
  let exited = false
  const startedAt = Date.now()

  const onLine = service.readyPattern
    ? (line) => {
        if (ready) return
        if (service.readyPattern.test(line)) ready = true
      }
    : null

  const child = spawn(service.command, service.args, {
    cwd: service.cwd,
    env: {
      ...process.env,
      ...(service.env ?? {}),
      ...(useColor ? { FORCE_COLOR: '1' } : {}),
    },
    stdio: ['inherit', 'pipe', 'pipe'],
  })

  children.set(service.name, child)
  pipeLines(service, child.stdout, process.stdout, onLine)
  pipeLines(service, child.stderr, process.stderr, onLine)

  child.on('exit', (code, signal) => {
    exited = true
    children.delete(service.name)

    const reason = signal ? `signal=${signal}` : `code=${code ?? 0}`
    const line = formatLine(service, color(`process exited (${reason})`, code ? ansi.red : ansi.dim))
    if (line) process.stdout.write(`${line}\n`)

    if (!shuttingDown) {
      stopAll()
      if (code !== 0) process.exitCode = code ?? 1
    }
  })

  if (!service.readyPattern) return

  const timeoutMs = service.readyTimeoutMs ?? 60000
  while (!ready && !exited && !shuttingDown && Date.now() - startedAt < timeoutMs) {
    await new Promise((r) => setTimeout(r, 100))
  }

  if (!ready && !exited) {
    const line = formatLine(
      service,
      color(`ready signal not seen in ${timeoutMs}ms — starting next service anyway`, ansi.yellow),
    )
    if (line) process.stdout.write(`${line}\n`)
  }
}

// Start services sequentially: each waits for the previous one to be ready.
for (const service of services) {
  if (shuttingDown) break
  await startService(service)
}

process.on('SIGINT', () => stopAll('SIGINT'))
process.on('SIGTERM', () => stopAll('SIGTERM'))
process.on('exit', () => stopAll())
