import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  config: {
    TURNSTILE_SITE_KEY: 'site-key',
    TURNSTILE_SECRET_KEY: 'secret-key',
  },
  checkRateLimit: vi.fn(),
}))

vi.mock('../config', () => ({
  config: mocks.config,
}))

vi.mock('../middleware/limits', () => ({
  checkRateLimit: mocks.checkRateLimit,
}))

import {
  checkLoginRateLimit,
  getTurnstileSiteKey,
  turnstileEnabled,
  verifyTurnstileToken,
} from './security'

beforeEach(() => {
  mocks.config.TURNSTILE_SITE_KEY = 'site-key'
  mocks.config.TURNSTILE_SECRET_KEY = 'secret-key'
  mocks.checkRateLimit.mockReset()
  vi.unstubAllGlobals()
})

describe('auth security helpers', () => {
  it('disables Turnstile unless both keys are configured', async () => {
    mocks.config.TURNSTILE_SECRET_KEY = ''
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(turnstileEnabled()).toBe(false)
    expect(getTurnstileSiteKey()).toBeNull()
    await expect(verifyTurnstileToken(undefined, '127.0.0.1')).resolves.toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('verifies Turnstile tokens with siteverify form fields', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(verifyTurnstileToken('token-1', '203.0.113.10')).resolves.toBe(true)

    const calls = fetchMock.mock.calls as unknown as Array<[string, { body: URLSearchParams }]>
    const body = calls[0]![1].body
    expect(body.get('secret')).toBe('secret-key')
    expect(body.get('response')).toBe('token-1')
    expect(body.get('remoteip')).toBe('203.0.113.10')
  })

  it('rejects failed Turnstile verification responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: false }),
    })))

    await expect(verifyTurnstileToken('bad-token')).resolves.toBe(false)
  })

  it('hashes account names before building login rate-limit keys', async () => {
    mocks.checkRateLimit.mockResolvedValue(true)

    await expect(checkLoginRateLimit('127.0.0.1', 'Admin@Example.com')).resolves.toBe(true)

    const key = mocks.checkRateLimit.mock.calls[0]?.[0] as string
    expect(key).toMatch(/^login:127\.0\.0\.1:[0-9a-f]{16}$/)
    expect(key).not.toContain('Admin')
    expect(key).not.toContain('Example')
  })
})
