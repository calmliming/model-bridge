import { once } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ sessions: vi.fn(), createAccount: vi.fn(), exchange: vi.fn(), metadata: vi.fn() }))
vi.mock('./db/index', () => ({ db: { delete: () => ({ where: () => ({ returning: mocks.sessions }) }) } }))
vi.mock('./accounts/manager', () => ({ createAccount: mocks.createAccount }))
vi.mock('./providers/registry', () => ({ getProvider: () => ({ exchangeCode: mocks.exchange, fetchAccountMetadata: mocks.metadata }) }))
import { startOauthCallbackServer, closeOauthCallbackServer } from './oauthCallback'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.sessions.mockResolvedValue([{ provider: 'antigravity', codeVerifier: 'pkce', createdAt: Date.now(), accountName: 'Native Google' }])
  mocks.exchange.mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3600000 })
  mocks.metadata.mockResolvedValue({ project: 'project' })
  mocks.createAccount.mockResolvedValue({ id: 'account' })
})

describe('native Antigravity callback', () => {
  async function run(check: (origin: string) => Promise<void>) {
    const server = startOauthCallbackServer({ port: 0, paths: ['/callback'], provider: 'antigravity' })
    if (!server.listening) await once(server, 'listening')
    const address = server.address() as { port: number }
    try { await check(`http://127.0.0.1:${address.port}`) } finally { await closeOauthCallbackServer(server) }
  }
  it('consumes a one-time session and saves the correct provider', () => run(async origin => {
    expect((await fetch(`${origin}/callback?code=code&state=state`)).status).toBe(200)
    expect(mocks.exchange).toHaveBeenCalledWith('code', 'pkce', 'state')
    expect(mocks.createAccount).toHaveBeenCalledWith(expect.objectContaining({ provider: 'antigravity', metadata: { project: 'project' } }))
    mocks.sessions.mockResolvedValue([])
    expect((await fetch(`${origin}/callback?code=code&state=state`)).status).toBe(400)
    expect(mocks.exchange).toHaveBeenCalledOnce()
  }))
  it('rejects expired state before token exchange and escapes callback errors', () => run(async origin => {
    mocks.sessions.mockResolvedValue([{ provider: 'antigravity', createdAt: Date.now() - 31 * 60000 }])
    expect((await fetch(`${origin}/callback?code=code&state=old`)).status).toBe(400)
    expect(mocks.exchange).not.toHaveBeenCalled()
    const response = await fetch(`${origin}/callback?error=${encodeURIComponent('<script>bad()</script>')}`)
    const html = await response.text()
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  }))
  it('returns a controlled failure when storage is unavailable', () => run(async origin => {
    mocks.sessions.mockRejectedValue(new Error('private database detail'))
    const response = await fetch(`${origin}/callback?code=code&state=state`)
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('private database detail')
  }))
})
