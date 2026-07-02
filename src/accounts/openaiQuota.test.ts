import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountQuotaSnapshot } from './quota'

const manager = vi.hoisted(() => ({
  ensureFreshToken: vi.fn(),
  getAccount: vi.fn(),
  refreshAccountToken: vi.fn(),
  updateAccountMetadata: vi.fn(),
  updateAccountQuota: vi.fn(),
}))

const openaiProvider = vi.hoisted(() => ({
  fetchOpenAIQuota: vi.fn(),
  resetOpenAIQuota: vi.fn(),
}))

const scheduler = vi.hoisted(() => ({
  clearAccountCooldown: vi.fn(),
  penalizeAccount: vi.fn(),
}))

const settings = vi.hoisted(() => ({
  getQuotaAutopausePercent: vi.fn(),
}))

vi.mock('./manager', () => manager)
vi.mock('./scheduler', () => scheduler)
vi.mock('../db/settings', () => settings)

vi.mock('../providers/openai/quota', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../providers/openai/quota')>()
  return {
    ...actual,
    fetchOpenAIQuota: openaiProvider.fetchOpenAIQuota,
    resetOpenAIQuota: openaiProvider.resetOpenAIQuota,
  }
})

import { OpenAIQuotaError, queryOpenAIAccountQuota, resetOpenAIAccountQuota } from './openaiQuota'

const quota: AccountQuotaSnapshot = {
  source: 'openai',
  updatedAt: 1_700_000_000_000,
  windows: [],
  resetCredits: 2,
}

function openAIAccount(metadata: unknown) {
  return {
    id: 'acct-1',
    provider: 'openai',
    name: 'OpenAI',
    status: 'active',
    oauthAccessToken: 'encrypted-access',
    oauthRefreshToken: 'encrypted-refresh',
    tokenExpiresAt: Date.now() + 60_000,
    cooldownUntil: null,
    weight: 1,
    concurrencyLimit: null,
    lastUsedAt: null,
    notes: null,
    metadata,
    createdAt: Date.now(),
  }
}

describe('queryOpenAIAccountQuota', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    manager.ensureFreshToken.mockResolvedValue('fresh-access-token')
    manager.refreshAccountToken.mockResolvedValue('fresh-access-token')
    manager.updateAccountMetadata.mockResolvedValue(undefined)
    manager.updateAccountQuota.mockResolvedValue(undefined)
    openaiProvider.fetchOpenAIQuota.mockResolvedValue(quota)
    scheduler.clearAccountCooldown.mockResolvedValue(undefined)
    scheduler.penalizeAccount.mockResolvedValue(undefined)
    settings.getQuotaAutopausePercent.mockResolvedValue(100)
  })

  it('forces a token refresh to backfill a missing ChatGPT account id before querying quota', async () => {
    manager.getAccount
      .mockResolvedValueOnce(openAIAccount({}))
      .mockResolvedValueOnce(openAIAccount({ openai: { chatgptAccountId: 'chatgpt-account-1' } }))

    const result = await queryOpenAIAccountQuota('acct-1')

    expect(result.resetCredits).toBe(2)
    expect(manager.refreshAccountToken).toHaveBeenCalledWith('acct-1')
    expect(manager.ensureFreshToken).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { openai: { chatgptAccountId: 'chatgpt-account-1' } },
      }),
    )
    expect(openaiProvider.fetchOpenAIQuota).toHaveBeenCalledWith(
      'fresh-access-token',
      'chatgpt-account-1',
    )
  })

  it('keeps the reauthorization hint when a token refresh still cannot recover the ChatGPT account id', async () => {
    manager.getAccount.mockResolvedValueOnce(openAIAccount({})).mockResolvedValueOnce(openAIAccount({}))

    await expect(queryOpenAIAccountQuota('acct-1')).rejects.toMatchObject({
      name: 'OpenAIQuotaError',
      statusCode: 409,
      message: '缺少 ChatGPT 账户标识，无法刷新配额；请重新授权 OpenAI 账号后再试',
    } satisfies Partial<OpenAIQuotaError>)

    expect(manager.refreshAccountToken).toHaveBeenCalledWith('acct-1')
    expect(manager.ensureFreshToken).not.toHaveBeenCalled()
    expect(openaiProvider.fetchOpenAIQuota).not.toHaveBeenCalled()
  })
})

describe('resetOpenAIAccountQuota', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    manager.ensureFreshToken.mockResolvedValue('fresh-access-token')
    manager.updateAccountMetadata.mockResolvedValue(undefined)
    manager.updateAccountQuota.mockResolvedValue(undefined)
    manager.getAccount.mockResolvedValue(
      openAIAccount({ openai: { chatgptAccountId: 'chatgpt-account-1' } }),
    )
    openaiProvider.resetOpenAIQuota.mockResolvedValue({ windowsReset: 1 })
    scheduler.clearAccountCooldown.mockResolvedValue(undefined)
    scheduler.penalizeAccount.mockResolvedValue(undefined)
    settings.getQuotaAutopausePercent.mockResolvedValue(100)
  })

  it('clears a stale cooldown once the reset frees the quota window', async () => {
    // Fresh snapshot after the reset: window well under threshold.
    openaiProvider.fetchOpenAIQuota.mockResolvedValue({
      source: 'openai',
      updatedAt: Date.now(),
      windows: [
        { key: 'hourly', label: '5小时', usedPercent: 1, resetAt: Date.now() + 3_600_000, exceeded: false },
      ],
      resetCredits: 1,
    } satisfies AccountQuotaSnapshot)

    const result = await resetOpenAIAccountQuota('acct-1')

    expect(result.windowsReset).toBe(1)
    expect(scheduler.clearAccountCooldown).toHaveBeenCalledWith('acct-1')
    expect(scheduler.penalizeAccount).not.toHaveBeenCalled()
  })

  it('keeps the account paused when a window still breaches the threshold after reset', async () => {
    const resetAt = Date.now() + 7 * 24 * 3_600_000
    openaiProvider.fetchOpenAIQuota.mockResolvedValue({
      source: 'openai',
      updatedAt: Date.now(),
      windows: [
        { key: 'weekly', label: '7天', usedPercent: 100, resetAt, exceeded: true },
      ],
      resetCredits: 1,
    } satisfies AccountQuotaSnapshot)

    await resetOpenAIAccountQuota('acct-1')

    expect(scheduler.penalizeAccount).toHaveBeenCalledWith('acct-1', 'rate_limited', resetAt)
    expect(scheduler.clearAccountCooldown).not.toHaveBeenCalled()
  })

  it('clears the cooldown optimistically when the post-reset quota refresh fails', async () => {
    openaiProvider.fetchOpenAIQuota.mockRejectedValue(new Error('upstream down'))

    await resetOpenAIAccountQuota('acct-1')

    expect(scheduler.clearAccountCooldown).toHaveBeenCalledWith('acct-1')
    expect(scheduler.penalizeAccount).not.toHaveBeenCalled()
  })
})
