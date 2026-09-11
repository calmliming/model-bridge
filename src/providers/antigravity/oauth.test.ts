import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), close: vi.fn(), proxy: vi.fn() }))
vi.mock('../../config', () => ({ config: { ANTIGRAVITY_OAUTH_CLIENT_ID: 'antigravity-client', ANTIGRAVITY_OAUTH_CLIENT_SECRET: 'test-secret',
  ANTIGRAVITY_USER_AGENT_VERSION: '2.9.1', ANTIGRAVITY_PROXY_URL: 'http://127.0.0.1:7890' } }))
vi.mock('../../http/upstream', () => ({ fetchWithConnectTimeout: mocks.fetch }))
vi.mock('undici', () => ({ ProxyAgent: class { constructor(url: string) { mocks.proxy(url) } close() { return mocks.close() } } }))
import { buildAuthorizeUrl, generatePkce, exchangeCode, refreshToken, fetchAccountMetadata } from './oauth'
import { closeAntigravityDispatcher, fetchAntigravity } from './client'

beforeEach(async () => { await closeAntigravityDispatcher(); vi.clearAllMocks() })

describe('native Antigravity OAuth', () => {
  it('uses separate client, loopback callback, state and PKCE', () => {
    const pkce = generatePkce()
    const url = new URL(buildAuthorizeUrl('state-1', pkce.challenge))
    expect(url.searchParams.get('client_id')).toBe('antigravity-client')
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:8085/callback')
    expect(url.searchParams.get('state')).toBe('state-1')
    expect(url.searchParams.get('code_challenge')).toBe(pkce.challenge)
    expect(url.searchParams.get('scope')).toContain('/auth/experimentsandconfigs')
    expect(url.searchParams.has('client_secret')).toBe(false)
  })

  it('uses the same configured proxy for OAuth and account setup and keeps old refresh tokens', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response('{"access_token":"new-access","refresh_token":"refresh","expires_in":3600}'))
    await exchangeCode('code', 'verifier', 'state')
    expect(new URLSearchParams(mocks.fetch.mock.calls[0]![1].body).get('code_verifier')).toBe('verifier')
    mocks.fetch.mockResolvedValueOnce(new Response('{"access_token":"refreshed","expires_in":3600}'))
    expect((await refreshToken('existing')).refreshToken).toBe('existing')
    mocks.fetch.mockResolvedValueOnce(new Response('{"cloudaicompanionProject":{"id":"project-1"},"currentTier":{"id":"free-tier"},"paidTier":"g1-pro-tier"}'))
    expect(await fetchAccountMetadata('token')).toEqual({ project: 'project-1', googleCurrentTier: 'free-tier', googlePaidTier: 'g1-pro-tier' })
    expect(mocks.proxy).toHaveBeenCalledOnce()
    expect(mocks.fetch.mock.calls.every(call => call[3] === mocks.fetch.mock.calls[0]![3])).toBe(true)
  })

  it('onboards only the default tier returned by the service', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response('{"allowedTiers":[{"id":"free-tier","isDefault":true}]}'))
    mocks.fetch.mockResolvedValueOnce(new Response('{"done":true,"response":{"cloudaicompanionProject":"project-new"}}'))
    expect(await fetchAccountMetadata('token')).toEqual({ project: 'project-new' })
    expect(JSON.parse(mocks.fetch.mock.calls[1]![1].body).tierId).toBe('free-tier')
  })

  it('reports region ineligibility without inventing a project or onboarding another plan', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response('{"ineligibleTiers":[{"reasonMessage":"This service is not available in your country"}]}'))
    await expect(fetchAccountMetadata('token')).rejects.toThrow('google_location_unsupported')
    expect(mocks.fetch).toHaveBeenCalledOnce()
    expect(() => fetchAntigravity('https://untrusted.example/token', {})).toThrow('Unsupported')
  })
})
