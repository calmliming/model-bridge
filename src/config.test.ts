import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendFileSync } from 'node:fs'

vi.mock('dotenv', () => ({ config: vi.fn() }))
vi.mock('node:fs', () => ({ appendFileSync: vi.fn(), existsSync: vi.fn() }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('optional Redis configuration', () => {
  it.each([undefined, '', '  \t'])('accepts an unconfigured Redis URL (%s)', async (value) => {
    vi.stubEnv('REDIS_URL', value)
    const { config } = await import('./config')
    expect(config.REDIS_URL).toBeUndefined()
  })

  it.each(['redis://localhost:6379', 'rediss://localhost:6380'])('preserves %s', async (value) => {
    vi.stubEnv('REDIS_URL', value)
    const { config } = await import('./config')
    expect(config.REDIS_URL).toBe(value)
  })

  it.each(['not-a-url', 'https://localhost:6379'])('still rejects invalid Redis configuration (%s)', async (value) => {
    vi.stubEnv('REDIS_URL', value)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('invalid environment') })
    await expect(import('./config')).rejects.toThrow('invalid environment')
    expect(exit).toHaveBeenCalledWith(1)
  })
})

describe('initial admin password configuration', () => {
  it.each([undefined, '', '  \t'])('does not supply a default password for %s', async value => {
    vi.stubEnv('ADMIN_PASSWORD', value)
    expect((await import('./config')).config.ADMIN_PASSWORD).toBeUndefined()
  })

  it('preserves an old weak environment value so existing admin deployments can start', async () => {
    vi.stubEnv('ADMIN_PASSWORD', 'admin')
    expect((await import('./config')).config.ADMIN_PASSWORD).toBe('admin')
  })
})

describe('Claude CLI compatibility configuration', () => {
  it('rejects a configured version below the Fable 5.1 minimum', async () => {
    vi.stubEnv('CLAUDE_CLI_VERSION', '2.1.161')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('invalid environment') })
    await expect(import('./config')).rejects.toThrow('invalid environment')
  })
})

describe('Google website login configuration', () => {
  it.each([undefined, '', '  '])('keeps Google login disabled for %s', async (value) => {
    vi.stubEnv('GOOGLE_LOGIN_CLIENT_ID', value)
    expect((await import('./config')).config.GOOGLE_LOGIN_CLIENT_ID).toBeUndefined()
  })
  it('accepts a Web client ID independently of upstream credentials', async () => {
    vi.stubEnv('GOOGLE_LOGIN_CLIENT_ID', '123-web.apps.googleusercontent.com')
    expect((await import('./config')).config.GOOGLE_LOGIN_CLIENT_ID).toBe('123-web.apps.googleusercontent.com')
  })
  it('rejects a value that is not a Google client ID', async () => {
    vi.stubEnv('GOOGLE_LOGIN_CLIENT_ID', 'not-a-client')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('invalid environment') })
    await expect(import('./config')).rejects.toThrow('invalid environment')
  })
})

describe('persistent production secrets', () => {
  it.each(['ENCRYPTION_KEY', 'JWT_SECRET'])('refuses to generate a missing %s in production', async key => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv(key, '')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('missing production secret') })
    vi.mocked(appendFileSync).mockClear()
    await expect(import('./config')).rejects.toThrow('missing production secret')
    expect(exit).toHaveBeenCalledWith(1)
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`explicit ${key}`))
    expect(appendFileSync).not.toHaveBeenCalled()
  })

  it('keeps development generation and explicit production secrets', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('ENCRYPTION_KEY', '')
    vi.mocked(appendFileSync).mockClear()
    expect((await import('./config')).config.ENCRYPTION_KEY).toMatch(/^[a-f0-9]{64}$/)
    expect(appendFileSync).toHaveBeenCalledWith('.env', expect.stringContaining('ENCRYPTION_KEY='))
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'production')
    vi.mocked(appendFileSync).mockClear()
    expect((await import('./config')).config.JWT_SECRET).toBe('model-bridge-test-secret')
    expect(appendFileSync).not.toHaveBeenCalled()
  })
})
