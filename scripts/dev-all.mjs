#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const npmCli = process.platform === 'win32' ? process.env.npm_execpath : undefined
const npmCommand = npmCli ? process.execPath : process.platform === 'win32' ? 'cmd.exe' : 'npm'
const npmArgsPrefix = npmCli ? [npmCli] : process.platform === 'win32' ? ['/d', '/s', '/c', 'npm'] : []
const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined

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
    readyTimeoutMs: 20000,
  },
  {
    name: 'frontend',
    label: 'WEB',
    color: ansi.green,
    cwd: resolve(rootDir, 'web'),
    command: npmCommand,
    args: [...npmArgsPrefix, 'run', '--silent', 'dev'],
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

function startService(service) {
  // Resolves once the service signals readiness (or immediately when no
  // readyPattern is configured). Lets us start dependents in order.
  let resolveReady
  const ready = new Promise((resolve) => {
    resolveReady = resolve
  })

  const onLine = service.readyPattern
    ? (line) => {
        if (service.readyPattern.test(line)) resolveReady()
      }
    : null

  const child = spawn(service.command, service.args, {
    cwd: service.cwd,
    env: {
      ...process.env,
      ...(useColor ? { FORCE_COLOR: '1' } : {}),
    },
    stdio: ['inherit', 'pipe', 'pipe'],
  })

  children.set(service.name, child)
  pipeLines(service, child.stdout, process.stdout, onLine)
  pipeLines(service, child.stderr, process.stderr, onLine)

  child.on('exit', (code, signal) => {
    children.delete(service.name)
    // Unblock the startup chain if the service dies before becoming ready.
    resolveReady()

    const reason = signal ? `signal=${signal}` : `code=${code ?? 0}`
    const line = formatLine(service, color(`process exited (${reason})`, code ? ansi.red : ansi.dim))
    if (line) process.stdout.write(`${line}\n`)

    if (!shuttingDown) {
      stopAll()
      if (code !== 0) process.exitCode = code ?? 1
    }
  })

  if (service.readyPattern) {
    const timeout = new Promise((resolve) => {
      const timer = setTimeout(() => {
        const line = formatLine(
          service,
          color(`ready signal not seen in ${service.readyTimeoutMs}ms — starting next service anyway`, ansi.yellow),
        )
        if (line) process.stdout.write(`${line}\n`)
        resolve()
      }, service.readyTimeoutMs ?? 20000)
      timer.unref?.()
    })
    return Promise.race([ready, timeout])
  }

  return ready
}

// Start services sequentially: each waits for the previous one to be ready.
for (const service of services) {
  if (shuttingDown) break
  await startService(service)
}

process.on('SIGINT', () => stopAll('SIGINT'))
process.on('SIGTERM', () => stopAll('SIGTERM'))
process.on('exit', () => stopAll())
