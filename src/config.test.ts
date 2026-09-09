import { afterEach, describe, expect, it, vi } from 'vitest'

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
