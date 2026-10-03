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

import { testAccountConnectivity, refreshAccountQuota } from './tester'
import { resetCodexCatalogCache } from '../providers/openai/codexCatalog'

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

describe('refreshAccountQuota (providers without a usage endpoint)', () => {
  const grsaiAccount = {
    ...deepseekAccount('active', null),
    id: 'acct-grsai',
    provider: 'grsai',
    name: 'GrsAI',
    proxyUrl: 'https://grsaiapi.com',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    manager.getAccount.mockResolvedValue(grsaiAccount)
    manager.ensureFreshToken.mockResolvedValue('sk-grsai')
    settings.getQuotaAutopausePercent.mockResolvedValue(100)
  })

  it('reports the missing usage endpoint instead of a bare quota success', async () => {
    upstream.fetchWithConnectTimeout.mockResolvedValue(
      new Response('{"error":"result not exist, valid for 2 hours"}', { status: 404 }),
    )

    const result = await refreshAccountQuota('acct-grsai')

    // The probe still runs, so the admin keeps a working action on the cell.
    expect(String(upstream.fetchWithConnectTimeout.mock.calls[0]?.[0]))
      .toBe('https://grsaiapi.com/v1/api/result?id=model-bridge-connectivity-probe')
    expect(result.success).toBe(true)
    expect(result.message).toBe('该渠道未提供余额 / 配额查询接口，已改为连通性检查')
    expect(manager.updateAccountQuota).not.toHaveBeenCalled()
    expect(manager.updateAccountMetadata).not.toHaveBeenCalled()
  })
})

describe('testAccountConnectivity (OpenAI probe model)', () => {
  const openaiAccount = {
    ...deepseekAccount('active', null),
    id: 'acct-oa',
    provider: 'openai',
    name: 'Codex',
    metadata: { openai: { chatgptAccountId: 'chatgpt-1' } },
  }
  const manifest = (models: unknown[]) =>
    new Response(JSON.stringify({ models }), { status: 200, headers: { 'content-type': 'application/json' } })
  const probeModel = () => {
    const call = upstream.fetchWithConnectTimeout.mock.calls.find(([url]) => String(url).endsWith('/codex/responses'))
    return JSON.parse(String(call?.[1]?.body)).model
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetCodexCatalogCache()
    manager.ensureFreshToken.mockResolvedValue('oauth-token')
    manager.getAccount.mockResolvedValue(openaiAccount)
    settings.getQuotaAutopausePercent.mockResolvedValue(100)
  })

  it('probes the newest model the account catalog offers', async () => {
    upstream.fetchWithConnectTimeout
      .mockResolvedValueOnce(manifest([
        { slug: 'gpt-6-luna' },
        { slug: 'gpt-6-sol' },
        { slug: 'gpt-6.1-sol' },
        { slug: 'gpt-5.4', visibility: 'hide' },
      ]))
      .mockResolvedValueOnce(new Response('data: {}\n\n', { status: 200 }))

    const result = await testAccountConnectivity('acct-oa')

    const [catalogUrl, catalogInit] = upstream.fetchWithConnectTimeout.mock.calls[0]!
    expect(String(catalogUrl)).toContain('/backend-api/codex/models?client_version=')
    expect(catalogInit.headers).toMatchObject({ 'ChatGPT-Account-ID': 'chatgpt-1' })
    expect(probeModel()).toBe('gpt-6.1-sol')
    expect(result.message).toContain('gpt-6.1-sol')
  })

  it('steps down to the newest model a plan without gpt-6.1-sol carries', async () => {
    upstream.fetchWithConnectTimeout
      .mockResolvedValueOnce(manifest([{ slug: 'gpt-6-luna' }, { slug: 'gpt-6-sol' }]))
      .mockResolvedValueOnce(new Response('data: {}\n\n', { status: 200 }))

    await testAccountConnectivity('acct-oa')

    expect(probeModel()).toBe('gpt-6-sol')
  })

  it('falls back to the first catalog model when none of the preferred ones is offered', async () => {
    upstream.fetchWithConnectTimeout
      .mockResolvedValueOnce(manifest([{ slug: 'gpt-7-nova' }, { slug: 'gpt-7-mini' }]))
      .mockResolvedValueOnce(new Response('data: {}\n\n', { status: 200 }))

    await testAccountConnectivity('acct-oa')

    expect(probeModel()).toBe('gpt-7-nova')
  })

  it('still probes with the default model when the catalog is unreadable', async () => {
    upstream.fetchWithConnectTimeout
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response('data: {}\n\n', { status: 200 }))

    const result = await testAccountConnectivity('acct-oa')

    expect(result.success).toBe(true)
    expect(probeModel()).toBe('gpt-6.1-sol')
  })
})
