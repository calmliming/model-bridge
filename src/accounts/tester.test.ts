import { beforeEach, describe, expect, it, vi } from 'vitest'

const manager = vi.hoisted(() => ({
  ensureFreshToken: vi.fn(),
  getAccount: vi.fn(),
  updateAccountMetadata: vi.fn(),
  updateAccountQuota: vi.fn(),
}))

const scheduler = vi.hoisted(() => ({
  clearAccountCooldown: vi.fn(),
  markAccountUsed: vi.fn(),
  penalizeAccount: vi.fn(),
  penalizeAccountModel: vi.fn(),
}))

const settings = vi.hoisted(() => ({
  getQuotaAutopausePercent: vi.fn(),
}))

const upstream = vi.hoisted(() => ({
  fetchWithConnectTimeout: vi.fn(),
}))

vi.mock('./manager', () => manager)
vi.mock('./scheduler', () => scheduler)
vi.mock('../db/settings', () => settings)
vi.mock('../http/upstream', () => upstream)

import { testAccountConnectivity } from './tester'

function deepseekAccount(status: string, cooldownUntil: number | null) {
  return {
    id: 'acct-ds',
    provider: 'deepseek',
    name: 'DeepSeek',
    status,
    cooldownUntil,
    oauthAccessToken: 'encrypted',
    tokenExpiresAt: null,
    proxyUrl: null,
    metadata: null,
  }
}

describe('testAccountConnectivity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    manager.ensureFreshToken.mockResolvedValue('sk-plain')
    settings.getQuotaAutopausePercent.mockResolvedValue(100)
    upstream.fetchWithConnectTimeout.mockResolvedValue(
      new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )
  })

  it('releases a rate-limit cooldown when the manual probe succeeds', async () => {
    manager.getAccount.mockResolvedValue(deepseekAccount('rate_limited', Date.now() + 30 * 60_000))

    const result = await testAccountConnectivity('acct-ds')

    expect(result.success).toBe(true)
    expect(scheduler.clearAccountCooldown).toHaveBeenCalledWith('acct-ds')
    expect(scheduler.markAccountUsed).toHaveBeenCalledWith('acct-ds')
    expect(scheduler.penalizeAccount).not.toHaveBeenCalled()
    expect(result.message).toContain('已解除限流冷却')
  })

  it('leaves the message untouched for an account that was not cooling', async () => {
    manager.getAccount.mockResolvedValue(deepseekAccount('active', null))

    const result = await testAccountConnectivity('acct-ds')

    expect(scheduler.clearAccountCooldown).toHaveBeenCalledWith('acct-ds')
    expect(result.message).not.toContain('已解除限流冷却')
  })

  it('keeps the account cooling when the probe itself is rejected upstream', async () => {
    manager.getAccount.mockResolvedValue(deepseekAccount('rate_limited', Date.now() + 30 * 60_000))
    upstream.fetchWithConnectTimeout.mockResolvedValue(
      new Response('{"error":"rate limit"}', { status: 429, statusText: 'Too Many Requests' }),
    )

    await expect(testAccountConnectivity('acct-ds')).rejects.toThrow('上游返回 429')
    expect(scheduler.clearAccountCooldown).not.toHaveBeenCalled()
    expect(scheduler.markAccountUsed).not.toHaveBeenCalled()
  })

  it('persists the DeepSeek wallet alongside a successful probe', async () => {
    manager.getAccount.mockResolvedValue(deepseekAccount('active', null))
    upstream.fetchWithConnectTimeout
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        is_available: true,
        balance_infos: [
          { currency: 'CNY', total_balance: '88.80', granted_balance: '8.80', topped_up_balance: '80.00' },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const result = await testAccountConnectivity('acct-ds')

    expect(upstream.fetchWithConnectTimeout.mock.calls[1]?.[0]).toBe('https://api.deepseek.com/user/balance')
    expect(manager.updateAccountMetadata).toHaveBeenCalledWith('acct-ds', {
      upstreamBalance: expect.objectContaining({
        provider: 'deepseek',
        currency: 'CNY',
        totalBalance: 88.8,
        granted: 8.8,
        remaining: 88.8,
      }),
    })
    expect(result.balance).toMatchObject({ totalBalance: 88.8, granted: 8.8 })
  })

  it('still succeeds when the balance endpoint is unavailable', async () => {
    manager.getAccount.mockResolvedValue(deepseekAccount('active', null))
    upstream.fetchWithConnectTimeout
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{"error":"boom"}', { status: 500 }))

    const result = await testAccountConnectivity('acct-ds')

    expect(result.success).toBe(true)
    expect(result.balance).toBeUndefined()
    expect(manager.updateAccountMetadata).not.toHaveBeenCalled()
  })
})
