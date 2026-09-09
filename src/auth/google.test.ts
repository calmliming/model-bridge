import { createSign, generateKeyPairSync } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuth2Client } from 'google-auth-library'

const mocks = vi.hoisted(() => ({
  config: { GOOGLE_LOGIN_CLIENT_ID: 'test.apps.googleusercontent.com' },
  getRedis: vi.fn(),
}))
vi.mock('../config', () => ({ config: mocks.config }))
vi.mock('../store/redis', () => ({ getRedis: mocks.getRedis }))
import { consumeGoogleNonce, createGoogleNonce, googleNonceValid, verifyGoogleCredential } from './google'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const nonce = 'a'.repeat(64)
function signedToken(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: 'https://accounts.google.com', aud: mocks.config.GOOGLE_LOGIN_CLIENT_ID,
    iat: now - 60, exp: now + 3600, sub: 'google-user-1', email: 'test@example.com',
    email_verified: true, nonce, name: 'Tester', ...overrides,
  }
  const input = [JSON.stringify({ alg: 'RS256', kid: 'test' }), JSON.stringify(payload)]
    .map(value => Buffer.from(value).toString('base64url')).join('.')
  return `${input}.${createSign('RSA-SHA256').update(input).sign(privateKey, 'base64url')}`
}

beforeEach(() => {
  mocks.getRedis.mockReturnValue(null)
  mocks.config.GOOGLE_LOGIN_CLIENT_ID = 'test.apps.googleusercontent.com'
  vi.spyOn(OAuth2Client.prototype, 'getFederatedSignonCertsAsync').mockResolvedValue({
    certs: { test: pem }, format: 'PEM',
  } as Awaited<ReturnType<OAuth2Client['getFederatedSignonCertsAsync']>>)
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('Google ID token verification with real RSA signatures', () => {
  it('accepts a signed Google identity for this client and browser nonce', async () => {
    await expect(verifyGoogleCredential(signedToken(), nonce)).resolves.toEqual({
      sub: 'google-user-1', email: 'test@example.com', name: 'Tester',
    })
  })
  it.each([
    { aud: 'another-client.apps.googleusercontent.com' },
    { iss: 'https://attacker.example' },
    { exp: 1 },
    { nonce: 'other-browser' },
    { email_verified: false },
    { sub: '' },
    { email: 'invalid-email' },
  ])('rejects invalid claims %j', async (claims) => {
    await expect(verifyGoogleCredential(signedToken(claims), nonce)).rejects.toMatchObject({ statusCode: 401 })
  })
  it('rejects a forged signature', async () => {
    const token = signedToken()
    const parts = token.split('.')
    parts[2] = Buffer.alloc(256).toString('base64url')
    await expect(verifyGoogleCredential(parts.join('.'), nonce)).rejects.toMatchObject({ statusCode: 401 })
  })
  it('does not authenticate when unconfigured', async () => {
    mocks.config.GOOGLE_LOGIN_CLIENT_ID = ''
    await expect(verifyGoogleCredential(signedToken(), nonce)).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('Google browser challenges', () => {
  it('is single use even under concurrent consumption', async () => {
    const value = await createGoogleNonce()
    expect(await googleNonceValid(value)).toBe(true)
    expect(await Promise.all([consumeGoogleNonce(value), consumeGoogleNonce(value)])).toEqual([true, false])
    expect(await googleNonceValid(value)).toBe(false)
  })
  it('rejects expired and malformed nonces', async () => {
    vi.useFakeTimers()
    const value = await createGoogleNonce()
    vi.advanceTimersByTime(300_001)
    expect(await googleNonceValid(value)).toBe(false)
    expect(await consumeGoogleNonce(value)).toBe(false)
    expect(await googleNonceValid('../invalid')).toBe(false)
  })
  it('shares expiring challenges through Redis and consumes atomically', async () => {
    const redis = { set: vi.fn(), exists: vi.fn().mockResolvedValue(1), del: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0) }
    mocks.getRedis.mockReturnValue(redis)
    const value = await createGoogleNonce()
    expect(redis.set).toHaveBeenCalledWith(`auth:google:nonce:${value}`, '1', 'EX', 300)
    expect(await googleNonceValid(value)).toBe(true)
    expect(await consumeGoogleNonce(value)).toBe(true)
    expect(await consumeGoogleNonce(value)).toBe(false)
  })
  it('fails closed if configured Redis becomes unavailable', async () => {
    const value = await createGoogleNonce()
    mocks.getRedis.mockReturnValue({ exists: vi.fn().mockRejectedValue(new Error('offline')), del: vi.fn().mockRejectedValue(new Error('offline')) })
    await expect(googleNonceValid(value)).rejects.toThrow('offline')
    await expect(consumeGoogleNonce(value)).rejects.toThrow('offline')
  })
})
