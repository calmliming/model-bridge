import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))

const TARGET = 'a01aefc716a7962bf5a21508389e6804911e1480'
const OLD = 'b25d05e0000000000000000000000000000000000'
let server, origin, state, commands

beforeEach(async () => {
  vi.resetModules()
  vi.stubEnv('UPDATE_TOKEN', 'test-token')
  vi.stubEnv('UPDATE_REMOTE', 'origin')
  vi.stubEnv('UPDATE_BRANCH', 'main')
  vi.stubEnv('UPDATE_SERVICE', 'model-bridge')
  state = { head: TARGET, runtimeVersion: '0.2.2', runtimeCommit: null, dirty: false, failBuild: false, staleVersion: false, staleCommit: false }
  commands = []
  mocks.spawn.mockImplementation((command, args, options) => {
    commands.push({ command, args, buildCommit: options.env.BUILD_COMMIT })
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = vi.fn()
    queueMicrotask(() => {
      try {
        const output = simulate(command, args)
        if (output) child.stdout.emit('data', Buffer.from(output))
        child.emit('close', 0)
      } catch (err) {
        child.stderr.emit('data', Buffer.from(err.message))
        child.emit('close', 1)
      }
    })
    return child
  })
  const { createUpdaterServer } = await import('./updater.mjs')
  server = createUpdaterServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
})

afterEach(async () => {
  server?.closeAllConnections()
  if (server) await new Promise(resolve => server.close(resolve))
  vi.unstubAllEnvs()
})

function simulate(command, args) {
  if (command === 'git') {
    switch (args[0]) {
      case 'status': return state.dirty ? ' M src/index.ts' : ''
      case 'fetch': return ''
      case 'rev-parse': {
        const commit = args.at(-1) === 'HEAD' ? state.head : TARGET
        return args.includes('--short') ? commit.slice(0, 7) : commit
      }
      case 'show': return JSON.stringify({ version: args[1].startsWith('HEAD:') && state.head !== TARGET ? '0.2.2' : '0.3.1' })
      case 'reset': state.head = args[2]; return ''
    }
  }
  if (command === 'docker' && args[0] === 'compose') {
    switch (args[1]) {
      case 'version': return 'Docker Compose'
      case 'up':
        if (state.failBuild) { state.failBuild = false; throw new Error('build failed') }
        if (!state.staleVersion) state.runtimeVersion = '0.3.1'
        if (!state.staleCommit) state.runtimeCommit = TARGET
        return ''
      case 'exec': return JSON.stringify({ version: state.runtimeVersion, commit: state.runtimeCommit })
    }
  }
  throw new Error(`unexpected command: ${command} ${args.join(' ')}`)
}

async function request(path, method = 'GET') {
  const response = await fetch(`${origin}${path}`, {
    method, headers: { Authorization: 'Bearer test-token' },
  })
  expect(response.ok).toBe(true)
  return response.json()
}

async function update() {
  await request('/update', 'POST')
  let result
  await vi.waitFor(async () => {
    result = await request('/status')
    expect(['succeeded', 'failed']).toContain(result.status)
  })
  return result
}

describe('updater deployment recovery', () => {
  it('rebuilds and recreates the service even when Git already matches the target', async () => {
    const result = await update()
    expect(result).toMatchObject({ status: 'succeeded', message: 'update_succeeded', currentVersion: '0.3.1', currentCommit: 'a01aefc' })
    expect(result.logTail).toContain('repository already up to date; rebuilding')
    expect(commands.some(c => c.command === 'git' && c.args[0] === 'reset')).toBe(false)
    expect(commands.find(c => c.args[1] === 'up')).toEqual({
      command: 'docker', args: ['compose', 'up', '-d', '--build', '--force-recreate', '--no-deps', 'model-bridge'], buildCommit: TARGET,
    })
  })

  it('retries a failed build after the checkout has already moved to the latest commit', async () => {
    state.head = OLD
    state.failBuild = true
    expect(await update()).toMatchObject({ status: 'failed' })
    expect(state.head).toBe(TARGET)
    expect(commands.find(c => c.args[0] === 'reset')?.args).toEqual(['reset', '--hard', TARGET])
    expect(await update()).toMatchObject({ status: 'succeeded', currentVersion: '0.3.1' })
    expect(commands.filter(c => c.args[1] === 'up')).toHaveLength(2)
  })

  it('does not report success if Compose exits successfully but the service version is still old', async () => {
    state.staleVersion = true
    expect(await update()).toMatchObject({ status: 'failed', error: expect.stringContaining('version mismatch') })
  })

  it('does not report success for a service built from a different commit', async () => {
    state.staleCommit = true
    state.runtimeCommit = OLD
    expect(await update()).toMatchObject({ status: 'failed', error: expect.stringContaining('commit does not match') })
  })

  it('blocks deployment when tracked files have local changes', async () => {
    state.dirty = true
    expect(await update()).toMatchObject({ status: 'failed', error: 'tracked worktree changes block update' })
    expect(commands.some(c => c.command === 'docker' || c.args[0] === 'reset')).toBe(false)
  })
})
