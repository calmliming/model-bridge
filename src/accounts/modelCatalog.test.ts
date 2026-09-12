import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ account: vi.fn(), token: vi.fn(), update: vi.fn(), fetch: vi.fn(), query: vi.fn() }))
vi.mock('./manager', () => ({ getAccount: mocks.account, ensureFreshToken: mocks.token, updateAccountMetadata: mocks.update }))
vi.mock('../http/upstream', () => ({ fetchWithConnectTimeout: mocks.fetch }))
vi.mock('../db', () => ({ pool: { query: mocks.query } }))
import { catalogSourceKey, cachedAccountCatalogs, syncAccountCatalog } from './modelCatalog'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.account.mockResolvedValue({ id: 'a', provider: 'openai', status: 'active', proxyUrl: null, metadata: { openai: { chatgptAccountId: 'acct-1' } } })
  mocks.token.mockResolvedValue('fake-token')
  mocks.update.mockResolvedValue(undefined)
})
describe('account catalog synchronization', () => {
  it('shares concurrent sync and persists only normalized data without changing account state', async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ models: [{ slug: 'gpt-new', token: 'secret' }] })))
    await Promise.all([syncAccountCatalog('a'), syncAccountCatalog('a')])
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.fetch.mock.calls[0][1].headers).toMatchObject({ 'ChatGPT-Account-ID': 'acct-1' })
    expect(mocks.update.mock.calls[0][1]).toMatchObject({ modelCatalog: { models: [{ id: 'gpt-new' }] }, modelCatalogError: null })
    expect(JSON.stringify(mocks.update.mock.calls)).not.toContain('secret')
  })
  it('keeps the successful snapshot on failure and sanitizes upstream errors', async () => {
    mocks.fetch.mockResolvedValue(new Response('secret at https://private', { status: 503 }))
    await expect(syncAccountCatalog('a')).rejects.toThrow('HTTP 503')
    expect(mocks.update.mock.calls[0][1]).not.toHaveProperty('modelCatalog')
    expect(JSON.stringify(mocks.update.mock.calls)).not.toContain('private')
  })
  it('rejects oversized responses without replacing a cached snapshot', async () => {
    mocks.fetch.mockResolvedValue(new Response('x'.repeat(2 * 1024 * 1024 + 1)))
    await expect(syncAccountCatalog('a')).rejects.toThrow('同步失败')
    expect(mocks.update.mock.calls[0][1]).not.toHaveProperty('modelCatalog')
  })
  it('preserves discovery fallback for an unsynced member while retaining new model IDs', async () => {
    mocks.query.mockResolvedValue({ rows: [
      { provider: 'openai', proxy_url: null, metadata: { modelCatalog: { version: 1, sourceKey: catalogSourceKey('openai', null), syncedAt: 1, models: [{ id: 'gpt-new', context_window: 200000 }] } } },
      { provider: 'openai', proxy_url: null, metadata: null },
    ] })
    const result = await cachedAccountCatalogs('group-a', ['openai'])
    expect(result.providerModels.openai).toBeUndefined()
    expect(result.catalogModels.openai?.['gpt-new']).toEqual({ id: 'gpt-new' })
    expect(mocks.query.mock.calls[0][1]).toEqual([['openai'], 'group-a'])
  })
})
