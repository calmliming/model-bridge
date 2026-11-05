#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import http from 'node:http'
import { pathToFileURL } from 'node:url'

const UPDATE_TOKEN = (process.env.UPDATE_TOKEN ?? '').trim()
const REPO_DIR = process.env.REPO_DIR || '/repo'
const UPDATER_PORT = Number.parseInt(process.env.UPDATER_PORT || '3002', 10)
const UPDATE_REMOTE = process.env.UPDATE_REMOTE || 'origin'
const UPDATE_BRANCH = process.env.UPDATE_BRANCH || 'main'
const UPDATE_SERVICE = process.env.UPDATE_SERVICE || 'model-bridge'

const MAX_LOG_CHARS = 12000
const FETCH_TIMEOUT_MS = 120000
const DOCKER_TIMEOUT_MS = 20 * 60 * 1000

const safeRemotePattern = /^[A-Za-z0-9._-]+$/
const safeBranchPattern = /^[A-Za-z0-9._/-]+$/
const safeServicePattern = /^[A-Za-z0-9._-]+$/

let composeCommand = null
let task = idleTask()

function idleTask() {
  return {
    operationId: null,
    status: 'idle',
    startedAt: null,
    finishedAt: null,
    logTail: '',
    message: null,
    error: null,
  }
}

function isActive() {
  return task.status === 'checking' || task.status === 'updating'
}

function isSafeConfig() {
  return (
    safeRemotePattern.test(UPDATE_REMOTE) &&
    safeBranchPattern.test(UPDATE_BRANCH) &&
    !UPDATE_BRANCH.includes('..') &&
    !UPDATE_BRANCH.startsWith('/') &&
    !UPDATE_BRANCH.endsWith('/') &&
    safeServicePattern.test(UPDATE_SERVICE)
  )
}

function redact(text) {
  let output = String(text)
  if (UPDATE_TOKEN) {
    output = output.split(UPDATE_TOKEN).join('[redacted]')
  }
  return output
}

function appendLog(text) {
  const line = redact(text)
  task.logTail = `${task.logTail}${task.logTail ? '\n' : ''}${line}`.slice(-MAX_LOG_CHARS)
}

class CommandError extends Error {
  constructor(message, output = '') {
    super(message)
    this.name = 'CommandError'
    this.output = output
  }
}

function quoteArg(value) {
  return /^[A-Za-z0-9_./:@=-]+$/.test(value) ? value : JSON.stringify(value)
}

function runCommand(command, args, { timeoutMs = FETCH_TIMEOUT_MS, log = false, env = {} } = {}) {
  if (log) appendLog(`$ ${[command, ...args].map(quoteArg).join(' ')}`)

  return new Promise((resolve, reject) => {
    let output = ''
    let killed = false
    const child = spawn(command, args, {
      cwd: REPO_DIR,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const timer = setTimeout(() => {
      killed = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 5000).unref()
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      output += chunk.toString('utf8')
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(new CommandError(err.message, output))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const cleaned = redact(output.trim())
      if (log && cleaned) appendLog(cleaned)
      if (killed) {
        reject(new CommandError(`${command} timed out`, cleaned))
      } else if (code !== 0) {
        reject(new CommandError(`${command} exited with code ${code}`, cleaned))
      } else {
        resolve(cleaned)
      }
    })
  })
}

function git(args, options = {}) {
  return runCommand('git', args, options)
}

async function ensureComposeCommand() {
  if (composeCommand) return composeCommand

  try {
    await runCommand('docker', ['compose', 'version'])
    composeCommand = { command: 'docker', prefix: ['compose'] }
    return composeCommand
  } catch {
    await runCommand('docker-compose', ['version'])
    composeCommand = { command: 'docker-compose', prefix: [] }
    return composeCommand
  }
}

async function dockerCompose(args, env = {}) {
  const compose = await ensureComposeCommand()
  return runCommand(compose.command, [...compose.prefix, ...args], {
    timeoutMs: DOCKER_TIMEOUT_MS,
    log: true,
    env,
  })
}

async function packageVersionAt(ref) {
  try {
    const raw = await git(['show', `${ref}:package.json`])
    const parsed = JSON.parse(raw)
    return typeof parsed.version === 'string' && parsed.version.trim()
      ? parsed.version.trim()
      : null
  } catch {
    return null
  }
}

async function inspectRepository({ log = false } = {}) {
  const dirtyOutput = await git(['status', '--porcelain', '--untracked-files=no'], { log })
  const dirty = dirtyOutput.trim().length > 0
  await git(['fetch', UPDATE_REMOTE, UPDATE_BRANCH], { timeoutMs: FETCH_TIMEOUT_MS, log })

  const [currentFull, latestFull, currentCommit, latestCommit, currentVersion, latestVersion] = await Promise.all([
    git(['rev-parse', 'HEAD']),
    git(['rev-parse', 'FETCH_HEAD']),
    git(['rev-parse', '--short', 'HEAD']),
    git(['rev-parse', '--short', 'FETCH_HEAD']),
    packageVersionAt('HEAD'),
    packageVersionAt('FETCH_HEAD'),
  ])

  return {
    currentCommit,
    latestCommit,
    currentVersion,
    latestVersion,
    currentCommitFull: currentFull,
    latestCommitFull: latestFull,
    hasUpdate: currentFull !== latestFull,
    branch: UPDATE_BRANCH,
    remote: UPDATE_REMOTE,
    dirty,
    checkedAt: Date.now(),
  }
}

async function checkUpdates() {
  return inspectRepository()
}

function failTask(err) {
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof CommandError && err.output) appendLog(err.output)
  task.status = 'failed'
  task.finishedAt = Date.now()
  task.error = redact(message)
}

async function runUpdate(operationId) {
  try {
    task.status = 'checking'
    appendLog(`update ${operationId} started`)
    const info = await inspectRepository({ log: true })
    Object.assign(task, {
      currentCommit: info.currentCommit,
      latestCommit: info.latestCommit,
      currentVersion: info.currentVersion,
      latestVersion: info.latestVersion,
      branch: info.branch,
      remote: info.remote,
      dirty: info.dirty,
    })

    if (info.dirty) {
      throw new Error('tracked worktree changes block update')
    }
    if (!info.hasUpdate) {
      appendLog('repository already up to date; rebuilding the running service')
    }

    task.status = 'updating'
    if (info.hasUpdate) {
      // A concurrent check may overwrite FETCH_HEAD; use the inspected commit.
      await git(['reset', '--hard', info.latestCommitFull], { timeoutMs: FETCH_TIMEOUT_MS, log: true })
    }
    const buildEnv = { BUILD_COMMIT: info.latestCommitFull }
    await dockerCompose(['up', '-d', '--build', '--force-recreate', '--no-deps', UPDATE_SERVICE], buildEnv)

    const runtime = JSON.parse(await dockerCompose([
      'exec', '-T', UPDATE_SERVICE, 'node', '--input-type=module', '-e',
      "import { readFileSync } from 'node:fs'; console.log(JSON.stringify({ version: JSON.parse(readFileSync('package.json', 'utf8')).version, commit: process.env.GIT_COMMIT || null }))",
    ], buildEnv))
    if (!runtime.version || (info.latestVersion && runtime.version !== info.latestVersion)) {
      throw new Error(`running service version mismatch: expected ${info.latestVersion}, got ${runtime.version ?? 'unknown'}`)
    }
    if (runtime.commit && runtime.commit !== info.latestCommitFull) {
      throw new Error('running service commit does not match the update target')
    }

    task.status = 'succeeded'
    task.currentVersion = runtime.version
    task.currentCommit = runtime.commit ? runtime.commit.slice(0, info.latestCommit.length) : null
    task.finishedAt = Date.now()
    task.message = 'update_succeeded'
    appendLog('update succeeded')
  } catch (err) {
    failTask(err)
  }
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function notFound(res) {
  sendJson(res, 404, { error: 'not found' })
}

function unauthorized(res) {
  sendJson(res, 401, { error: 'unauthorized' })
}

function methodNotAllowed(res) {
  sendJson(res, 405, { error: 'method not allowed' })
}

function requireAuth(req, res) {
  if (!UPDATE_TOKEN) {
    sendJson(res, 503, { error: 'UPDATE_TOKEN is not configured' })
    return false
  }
  const header = req.headers.authorization
  const value = Array.isArray(header) ? header[0] : header
  if (value !== `Bearer ${UPDATE_TOKEN}`) {
    unauthorized(res)
    return false
  }
  return true
}

async function drainRequest(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 1024 * 1024) {
        reject(new Error('request body too large'))
        req.destroy()
      }
    })
    req.on('end', resolve)
    req.on('error', reject)
  })
}

async function handle(req, res) {
  const url = new URL(req.url || '/', 'http://model-bridge-updater')

  if (url.pathname === '/health') {
    sendJson(res, 200, {
      status: UPDATE_TOKEN ? 'ok' : 'disabled',
      service: 'model-bridge-updater',
    })
    return
  }

  if (!requireAuth(req, res)) return
  if (!isSafeConfig()) {
    sendJson(res, 500, { error: 'invalid updater environment configuration' })
    return
  }

  try {
    if (req.method === 'POST') await drainRequest(req)

    if (url.pathname === '/check') {
      if (req.method !== 'POST') return methodNotAllowed(res)
      sendJson(res, 200, await checkUpdates())
      return
    }

    if (url.pathname === '/update') {
      if (req.method !== 'POST') return methodNotAllowed(res)
      if (isActive()) {
        sendJson(res, 200, task)
        return
      }
      const operationId = `upd_${Date.now()}_${randomBytes(3).toString('hex')}`
      task = {
        ...idleTask(),
        operationId,
        status: 'checking',
        startedAt: Date.now(),
      }
      void runUpdate(operationId)
      sendJson(res, 202, task)
      return
    }

    if (url.pathname === '/status') {
      if (req.method !== 'GET') return methodNotAllowed(res)
      sendJson(res, 200, task)
      return
    }

    notFound(res)
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? redact(err.message) : 'updater error' })
  }
}

export function createUpdaterServer() {
  return http.createServer((req, res) => {
    void handle(req, res)
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createUpdaterServer().listen(UPDATER_PORT, '0.0.0.0', () => {
    console.log(`[updater] listening on ${UPDATER_PORT}`)
    if (!UPDATE_TOKEN) {
      console.warn('[updater] UPDATE_TOKEN is not configured; update endpoints are disabled')
    }
  })
}
