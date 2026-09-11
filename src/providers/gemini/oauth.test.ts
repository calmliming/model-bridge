import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isGoogleLocationUnsupported, googleErrorMessage } from '../google/errors'

beforeEach(() => {
  vi.stubEnv('GEMINI_OAUTH_CLIENT_ID', 'test-client')
  vi.stubEnv('GEMINI_OAUTH_CLIENT_SECRET', 'test-client-secret')
  vi.resetModules()
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('Gemini OAuth diagnostics', () => {
  it('uses bounded token exchange and preserves refresh tokens', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: 'access', expires_in: 3600 })))
    vi.stubGlobal('fetch', fetch)
    const oauth = await import('./oauth')
    expect((await oauth.refreshToken('existing-refresh')).refreshToken).toBe('existing-refresh')
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.redirect).toBe('error')
  })
  it('preserves returned project and tier metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ cloudaicompanionProject: { id: 'project-1' },
      currentTier: { id: 'free-tier' }, paidTier: { id: 'paid-tier' } }))))
    expect(await (await import('./oauth')).fetchAccountMetadata('token')).toEqual({ project: 'project-1', googleCurrentTier: 'free-tier', googlePaidTier: 'paid-tier' })
  })
  it('does not create credentials from malformed token responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))
    await expect((await import('./oauth')).exchangeCode('code', 'verifier', 'state')).rejects.toThrow('access token')
  })
  it('identifies location failures without mistaking generic permissions or schema errors', () => {
    expect(isGoogleLocationUnsupported(400, 'User location is not supported for the API use.')).toBe(true)
    expect(isGoogleLocationUnsupported(403, 'This service is not available in your country')).toBe(true)
    expect(isGoogleLocationUnsupported(403, 'The caller does not have permission')).toBe(false)
    expect(isGoogleLocationUnsupported(400, 'Invalid location field in function arguments')).toBe(false)
    expect(googleErrorMessage(400, '{"error":"invalid_grant"}')).toContain('invalid_grant')
  })
})
