import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PermanentRefreshError } from './refreshErrors'

/**
 * A minimal in-memory stand-in for the drizzle client. The manager path under
 * test only ever touches one account, so we ignore WHERE predicates and operate
 * on a single mutable row held in `state.account`.
 * `select(...).from(...).where(...)` resolves to `[state.account]`;
 * `update(...).set(patch).where(...)` shallow-merges `patch`, including the
 * JSONB merge expression used by updateAccountMetadata.
 */
const state = vi.hoisted(() => ({ account: {} as Record<string, any> }))

const fakeDb = vi.hoisted(() => ({
  select: () => ({ from: () => ({ where: () => Object.assign(Promise.resolve([{ ...state.account }]), {
    for: async () => [{ ...state.account }],
  }) }) }),
  update: () => ({
    set: (patch: Record<string, unknown>) => ({
      where: async () => {
        const chunks = (patch.metadata as { queryChunks?: unknown[] } | undefined)?.queryChunks
        const encodedMetadataPatch = chunks?.find(
          (chunk): chunk is string => typeof chunk === 'string' && chunk.startsWith('{'),
        )
        const nextPatch = encodedMetadataPatch
          ? {
              ...patch,
              metadata: {
                ...(state.account.metadata ?? {}),
                ...JSON.parse(encodedMetadataPatch),
              },
            }
          : patch
        Object.assign(state.account, nextPatch)
      },
    }),
  }),
}))

const scheduler = vi.hoisted(() => ({
  disableAccount: vi.fn(),
  clearExpiredAccountCooldowns: vi.fn(),
}))

const registry = vi.hoisted(() => ({ getProvider: vi.fn() }))

vi.mock('../db/index', () => ({ db: { ...fakeDb, transaction: async (run: (store: typeof fakeDb) => unknown) => run(fakeDb) }, pool: {} }))
vi.mock('../crypto', () => ({ encrypt: (v: string) => v, decrypt: (v: string) => v }))
vi.mock('../providers/registry', () => registry)
vi.mock('../middleware/limits', () => ({ currentConcurrency: vi.fn(async () => 0) }))
vi.mock('./scheduler', () => scheduler)

import { ensureFreshToken, refreshAccountToken } from './manager'

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
    state.account.metadata = { quota: { updatedAt: 123 } }
    registry.getProvider.mockReturnValue({
      id: 'openai',
      refreshToken: vi.fn().mockRejectedValue(new Error('{"error":"invalid_grant"}')),
    })

    await expect(refreshAccountToken('acct-1')).rejects.toBeInstanceOf(PermanentRefreshError)

    expect(state.account.status).toBe('disabled')
    expect(state.account.metadata?.reauth).toMatchObject({
      required: true,
      reason: 'invalid_grant',
      provider: 'openai',
    })
    expect(typeof state.account.metadata.reauth.at).toBe('number')
    expect(state.account.metadata.quota).toEqual({ updatedAt: 123 })
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

  it('shares one rotating-token refresh across simultaneous requests and a manual refresh', async () => {
    let finish!: () => void
    const wait = new Promise<void>(resolve => { finish = resolve })
    const refresh = vi.fn(async () => { await wait; return goodTokens })
    registry.getProvider.mockReturnValue({ refreshToken: refresh })
    const stale = { ...state.account }
    const first = ensureFreshToken(stale as any)
    const second = ensureFreshToken(stale as any)
    const manual = refreshAccountToken('acct-1')
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    finish()
    expect(await Promise.all([first, second, manual])).toEqual(['new-access', 'new-access', 'new-access'])
    expect(refresh).toHaveBeenCalledWith('enc-refresh')
    expect(state.account.status).toBe('active')
  })

  it('rechecks stored expiry instead of refreshing a stale scheduler snapshot', async () => {
    const stale = { ...state.account }
    Object.assign(state.account, { oauthAccessToken: 'already-refreshed', tokenExpiresAt: Date.now() + 3600000 })
    const refresh = vi.fn()
    registry.getProvider.mockReturnValue({ refreshToken: refresh })
    expect(await ensureFreshToken(stale as any)).toBe('already-refreshed')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('releases the shared task after a transient failure so the next call can retry', async () => {
    const refresh = vi.fn().mockRejectedValueOnce(new Error('network failed')).mockResolvedValueOnce(goodTokens)
    registry.getProvider.mockReturnValue({ refreshToken: refresh })
    await expect(refreshAccountToken('acct-1')).rejects.toThrow('network failed')
    await expect(refreshAccountToken('acct-1')).resolves.toBe('new-access')
    expect(refresh).toHaveBeenCalledTimes(2)
  })
})
