import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PermanentRefreshError } from './refreshErrors'

/**
 * A minimal in-memory stand-in for the drizzle client. The manager path under
 * test only ever touches one account, so we ignore WHERE predicates and operate
 * on a single mutable row held in `state.account`.
 * `select(...).from(...).where(...)` resolves to `[state.account]`;
 * `update(...).set(patch).where(...)` shallow-merges `patch`.
 */
const state = vi.hoisted(() => ({ account: {} as Record<string, any> }))

const fakeDb = vi.hoisted(() => ({
  select: () => ({ from: () => ({ where: async () => [state.account] }) }),
  update: () => ({
    set: (patch: Record<string, unknown>) => ({ where: async () => { Object.assign(state.account, patch) } }),
  }),
}))

const scheduler = vi.hoisted(() => ({
  disableAccount: vi.fn(),
  clearExpiredAccountCooldowns: vi.fn(),
}))

const registry = vi.hoisted(() => ({ getProvider: vi.fn() }))

vi.mock('../db/index', () => ({ db: fakeDb, pool: {} }))
vi.mock('../crypto', () => ({ encrypt: (v: string) => v, decrypt: (v: string) => v }))
vi.mock('../providers/registry', () => registry)
vi.mock('../middleware/limits', () => ({ currentConcurrency: vi.fn(async () => 0) }))
vi.mock('./scheduler', () => scheduler)

import { refreshAccountToken } from './manager'

const goodTokens = {
  accessToken: 'new-access',
  refreshToken: 'new-refresh',
  expiresAt: 2_000_000_000_000,
}

function baseAccount(overrides: Record<string, any> = {}) {
  return {
    id: 'acct-1',
    provider: 'openai',
    name: 'OpenAI',
    status: 'active',
    oauthAccessToken: 'enc-access',
    oauthRefreshToken: 'enc-refresh',
    tokenExpiresAt: 1_000_000_000_000,
    cooldownUntil: null,
    metadata: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // disableAccount mirrors the real scheduler mutation onto the fake row.
  scheduler.disableAccount.mockImplementation(async () => {
    state.account.status = 'disabled'
    state.account.cooldownUntil = null
  })
  state.account = baseAccount()
})

describe('refreshAccountToken', () => {
  it('disables the account and records a reauth marker on a permanent failure', async () => {
    registry.getProvider.mockReturnValue({
      id: 'openai',
      refreshToken: vi.fn().mockRejectedValue(new Error('{"error":"invalid_grant"}')),
    })

    await expect(refreshAccountToken('acct-1')).rejects.toBeInstanceOf(PermanentRefreshError)

    expect(scheduler.disableAccount).toHaveBeenCalledWith('acct-1')
    expect(state.account.status).toBe('disabled')
    expect(state.account.metadata?.reauth).toMatchObject({
      required: true,
      reason: 'invalid_grant',
      provider: 'openai',
    })
    expect(typeof state.account.metadata.reauth.at).toBe('number')
  })

  it('leaves the account untouched and rethrows the original error on a transient failure', async () => {
    const transient = new Error('token refresh failed (503): service unavailable')
    registry.getProvider.mockReturnValue({
      id: 'openai',
      refreshToken: vi.fn().mockRejectedValue(transient),
    })

    await expect(refreshAccountToken('acct-1')).rejects.toBe(transient)

    expect(scheduler.disableAccount).not.toHaveBeenCalled()
    expect(state.account.status).toBe('active')
    expect(state.account.metadata).toBeNull()
  })

  it('persists new tokens on success', async () => {
    registry.getProvider.mockReturnValue({
      id: 'openai',
      refreshToken: vi.fn().mockResolvedValue(goodTokens),
    })

    const token = await refreshAccountToken('acct-1')

    expect(token).toBe('new-access')
    expect(state.account.oauthAccessToken).toBe('new-access')
    expect(state.account.oauthRefreshToken).toBe('new-refresh')
    expect(state.account.tokenExpiresAt).toBe(2_000_000_000_000)
    expect(scheduler.disableAccount).not.toHaveBeenCalled()
  })

  it('clears the reauth marker and reactivates when a flagged account recovers', async () => {
    state.account = baseAccount({
      status: 'disabled',
      metadata: { reauth: { required: true, reason: 'invalid_grant', provider: 'openai', at: 1 } },
    })
    registry.getProvider.mockReturnValue({
      id: 'openai',
      refreshToken: vi.fn().mockResolvedValue(goodTokens),
    })

    await refreshAccountToken('acct-1')

    expect(state.account.status).toBe('active')
    expect(state.account.cooldownUntil).toBeNull()
    expect(state.account.metadata.reauth).toBeUndefined()
  })
})
