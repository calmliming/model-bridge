import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import formbody from '@fastify/formbody'

const quotaCalls = vi.hoisted(() => ({
  reset: vi.fn(async () => ({ quota: { windows: [], resetCredits: 7 }, windowsReset: 1, resetCredits: 7 })),
}))
vi.mock('../accounts/openaiQuota', () => ({
  queryOpenAIAccountQuotaReadOnly: vi.fn(async () => ({ quota: { windows: [], resetCredits: 7 }, resetCredits: 7 })),
  resetOpenAIAccountQuota: quotaCalls.reset,
}))

const database = vi.hoisted(() => {
  const raw = process.env.TEST_DATABASE_URL
  if (!raw) return null
  const url = new URL(raw)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_test')) throw new Error('Disposable local *_test database required')
  const schema = `management_qa_${Date.now()}_${Math.random().toString(16).slice(2)}`
  url.searchParams.set('options', `-c search_path=${schema}`)
  return { url: url.toString(), schema }
})
vi.mock('../config', async original => {
  const value = await original<typeof import('../config')>()
  return { ...value, config: { ...value.config, DATABASE_URL: database?.url ?? value.config.DATABASE_URL, MCP_PUBLIC_URL: 'https://bridge.example/api/mcp', MCP_FRONTEND_URL: 'https://console.example' } }
})
import { pool } from '../db'
import { initDb } from '../db/init'
import { config } from '../config'
import { registerManagementRoutes } from './routes'
import { registerMcpRoutes, digestVerifier } from './mcp'
import { updateUser } from '../users/manager'
import { updateAccountMetadata } from '../accounts/manager'
import { digest } from './access'
import { idempotentManagement } from './idempotency'
import { policySchema } from './permissions'
import { adminSessionVersion, revokeAdminSessions } from '../auth/sessionVersion'
import { blacklistMatches, saveRegistrationBlacklist, assertRegistrationEmailAllowed, disableBlacklistedUsers } from '../users/emailBlacklist'

describe.runIf(database)('management credentials and OAuth on PostgreSQL', () => {
  const app = Fastify()
  let adminToken: string, userToken: string, otherToken: string
  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA ${database!.schema}`)
    await initDb()
    await app.register(jwt, { secret: 'management-test-session-secret' })
    await app.register(formbody)
    registerManagementRoutes(app); registerMcpRoutes(app)
    adminToken = app.jwt.sign({ sub: 'admin', role: 'admin', ver: 0 })
    userToken = app.jwt.sign({ sub: 'user-1', role: 'user' })
    otherToken = app.jwt.sign({ sub: 'user-2', role: 'user' })
  })
  beforeEach(async () => {
    quotaCalls.reset.mockClear()
    await pool.query('TRUNCATE mcp_token_history,mcp_grants,management_keys,management_audit,usage_logs,account_group_members,accounts,users,settings,account_groups CASCADE')
    await pool.query(`INSERT INTO settings(key,value) VALUES('admin.user_id','admin-user'),('admin.username','admin'),('admin.password_hash','admin-fixture-hash')`)
    await pool.query(`INSERT INTO users(id,email,name,password_hash,status,balance_micros,accepted_at) VALUES
      ('admin-user','admin@example.test','Admin','admin-fixture-hash','active',1000000,1),
      ('user-1','user@example.test','One','user-hash','active',1000000,1),
      ('user-2','other@example.test','Two','other-hash','active',1000000,1)`)
    await pool.query(`INSERT INTO account_groups(id,name) VALUES('group-a','A'),('group-b','B');
      INSERT INTO accounts(id,name,provider,oauth_access_token) VALUES('account-a','A','openai','private-upstream-token'),('account-b','B','openai','private-upstream-token');
      INSERT INTO account_group_members(account_id,group_id) VALUES('account-a','group-a'),('account-b','group-b')`)
    await saveRegistrationBlacklist([])
  })
  afterAll(async () => {
    await app.close()
    await pool.query(`DROP SCHEMA IF EXISTS ${database!.schema} CASCADE`)
    await pool.end()
  })
  const browser = (token: string) => ({ authorization: `Bearer ${token}` })
  async function key(permissions: string[], extra: Record<string, unknown> = {}) {
    const response = await app.inject({ method: 'POST', url: '/api/admin/management-keys', headers: browser(adminToken), payload: { name: 'test tool', policy: { permissions, groupIds: ['group-a'], accountIds: null }, ...extra } })
    expect(response.statusCode).toBe(200)
    return response.json() as { id: string; key: string }
  }
  async function authorize(token = userToken, adminScope = false) {
    const registration = await app.inject({ method: 'POST', url: '/api/mcp/oauth/register', payload: { client_name: 'Fixture app', redirect_uris: ['http://127.0.0.1:9999/callback'] } })
    expect(registration.statusCode).toBe(201)
    const clientId = registration.json().client_id as string
    const verifier = randomBytes(48).toString('base64url')
    const authorization = { client_id: clientId, redirect_uri: 'http://127.0.0.1:9999/callback', resource: config.MCP_PUBLIC_URL!, response_type: 'code', code_challenge: digestVerifier(verifier), code_challenge_method: 'S256', state: 'fixture-state', scope: 'mcp.read' }
    const consent = await app.inject({ method: 'POST', url: '/api/mcp/oauth/consent', headers: browser(token), payload: { authorization, allow: true, adminScope } })
    expect(consent.statusCode).toBe(200)
    const redirect = new URL(consent.json().redirect)
    expect(redirect.searchParams.get('state')).toBe('fixture-state')
    const code = redirect.searchParams.get('code')!
    return { clientId, verifier, code, authorization }
  }
  async function exchange(authorization: Awaited<ReturnType<typeof authorize>>, override: Record<string, string> = {}) {
    return app.inject({ method: 'POST', url: '/api/mcp/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams({ client_id: authorization.clientId, grant_type: 'authorization_code', code: authorization.code, code_verifier: authorization.verifier, redirect_uri: authorization.authorization.redirect_uri, resource: config.MCP_PUBLIC_URL!, ...override }).toString() })
  }
  const call = (token: string, method: string, params?: unknown) => app.inject({ method: 'POST', url: '/api/mcp', headers: browser(token), payload: { jsonrpc: '2.0', id: 'test', method, ...(params === undefined ? {} : { params }) } })

  it('filters authorized accounts before counting/pagination and redacts credentials', async () => {
    const created = await key(['accounts.read'])
    const response = await app.inject({ method: 'GET', url: '/api/management/accounts?pageSize=1', headers: { 'x-admin-api-key': created.key } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ total: 1, accounts: [{ id: 'account-a' }] })
    expect(response.body).not.toContain('private-upstream-token')
    expect((await pool.query('SELECT key_hash FROM management_keys WHERE id=$1', [created.id])).rows[0].key_hash).toBe(digest(created.key))
    expect((await pool.query('SELECT policy FROM management_keys WHERE id=$1', [created.id])).rows[0].policy).not.toHaveProperty('key')
  })
  it('denies writes with read-only keys and checks scope atomically on status changes', async () => {
    const read = await key(['accounts.read'])
    const denied = await app.inject({ method: 'PATCH', url: '/api/management/accounts/account-a/status', headers: { 'x-admin-api-key': read.key }, payload: { status: 'disabled' } })
    expect(denied.statusCode).toBe(403)
    const write = await key(['accounts.status.write'])
    const outside = await app.inject({ method: 'PATCH', url: '/api/management/accounts/account-b/status', headers: { 'x-admin-api-key': write.key }, payload: { status: 'disabled' } })
    expect(outside.statusCode).toBe(404)
    const inside = await app.inject({ method: 'PATCH', url: '/api/management/accounts/account-a/status', headers: { 'x-admin-api-key': write.key }, payload: { status: 'disabled' } })
    expect(inside.statusCode).toBe(200)
    expect((await pool.query('SELECT status FROM accounts WHERE id=$1', ['account-b'])).rows[0].status).toBe('active')
  })
  it('expires, restricts IPs, rotates and revokes machine credentials without granting browser administration', async () => {
    const expired = await key(['accounts.read'], { expiresAt: Date.now() - 1 })
    expect((await app.inject({ method: 'GET', url: '/api/management/accounts', headers: { 'x-admin-api-key': expired.key } })).statusCode).toBe(401)
    const limited = await key(['accounts.read'], { allowedIps: ['192.0.2.0/24'] })
    expect((await app.inject({ method: 'GET', url: '/api/management/accounts', headers: { 'x-admin-api-key': limited.key } })).statusCode).toBe(401)
    const created = await key(['accounts.read'])
    expect((await app.inject({ method: 'GET', url: '/api/admin/management-keys', headers: browser(created.key) })).statusCode).toBe(401)
    const rotated = await app.inject({ method: 'POST', url: `/api/admin/management-keys/${created.id}/rotate`, headers: browser(adminToken) })
    expect(rotated.statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/management/accounts', headers: browser(created.key) })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/api/management/accounts', headers: browser(rotated.json().key) })).statusCode).toBe(200)
    await app.inject({ method: 'DELETE', url: `/api/admin/management-keys/${created.id}`, headers: browser(adminToken) })
    expect((await app.inject({ method: 'GET', url: '/api/management/accounts', headers: browser(rotated.json().key) })).statusCode).toBe(401)
  })
  it('rejects out-of-scope import destinations before storing upstream credentials', async () => {
    const created = await key(['accounts.import'])
    const response = await app.inject({ method: 'POST', url: '/api/management/accounts/import', headers: browser(created.key), payload: { name: 'unauthorized', provider: 'openai', accessToken: 'should-not-store', groupIds: ['group-b'] } })
    expect(response.statusCode).toBe(403)
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM accounts')).rows[0].count).toBe(2)
  })
  it('imports a scoped OAuth account once, encrypts credentials and retains its ChatGPT workspace identity', async () => {
    const created = await key(['accounts.import'])
    const request = { method: 'POST' as const, url: '/api/management/accounts/import', headers: { ...browser(created.key), 'idempotency-key': 'scoped-import-fixture-001' }, payload: { name: 'scoped fixture', provider: 'openai', accessToken: 'fixture-import-access', refreshToken: 'fixture-import-refresh', chatgptAccountId: 'fixture-workspace', groupIds: ['group-a'] } }
    const first = await app.inject(request), repeated = await app.inject(request)
    expect(first.statusCode).toBe(200); expect(repeated.json()).toEqual(first.json())
    expect(Object.keys(first.json())).toEqual(['id'])
    const row = (await pool.query('SELECT oauth_access_token,metadata FROM accounts WHERE id=$1', [first.json().id])).rows[0]
    expect(row.oauth_access_token).not.toContain('fixture-import-access')
    expect(row.metadata.openai.chatgptAccountId).toBe('fixture-workspace')
    expect((await pool.query("SELECT COUNT(*)::int AS count FROM accounts WHERE name='scoped fixture'")).rows[0].count).toBe(1)
    expect(JSON.stringify((await pool.query('SELECT * FROM management_audit')).rows)).not.toContain('fixture-import-access')
  })
  it('requires PKCE, exact redirect/resource, and rejects cross-origin MCP requests', async () => {
    const state = await authorize()
    expect((await exchange(state, { code_verifier: 'X'.repeat(64) })).statusCode).toBe(400)
    expect((await exchange(state, { resource: 'https://other.example/api/mcp' })).statusCode).toBe(400)
    expect((await exchange(state, { redirect_uri: 'https://evil.example/callback' })).statusCode).toBe(400)
    const valid = await exchange(state); expect(valid.statusCode).toBe(200)
    const response = await app.inject({ method: 'POST', url: '/api/mcp', headers: { ...browser(valid.json().access_token), origin: 'https://evil.example' }, payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
    expect(response.statusCode).toBe(403)
    expect((await call(userToken, 'tools/list')).statusCode).toBe(401)
  })
  it('keeps personal tool data owner-scoped and denies admin calls and JSON-RPC batches', async () => {
    await pool.query("INSERT INTO usage_logs(id,user_id,provider,model,cost) VALUES('own-log','user-1','openai','fixture-model',1),('other-log','user-2','openai','private-model',99)")
    const state = await authorize(), tokens = (await exchange(state)).json()
    const listed = await call(tokens.access_token, 'tools/list')
    expect(listed.json().result.tools.every((tool: any) => tool.name.startsWith('user_'))).toBe(true)
    const usage = await call(tokens.access_token, 'tools/call', { name: 'user_list_usage', arguments: {} })
    expect(usage.body).toContain('own-log'); expect(usage.body).not.toContain('other-log')
    const forbidden = await call(tokens.access_token, 'tools/call', { name: 'admin_list_accounts', arguments: {} })
    expect(forbidden.json().result.isError).toBe(true)
    const batch = await app.inject({ method: 'POST', url: '/api/mcp', headers: browser(tokens.access_token), payload: [{ jsonrpc: '2.0', id: 1, method: 'ping' }] })
    expect(batch.statusCode).toBe(400)
  })
  it('revokes a grant when its authorization code is reused', async () => {
    const state = await authorize(), initial = await exchange(state)
    expect(initial.statusCode).toBe(200)
    expect((await exchange(state)).statusCode).toBe(400)
    expect((await call(initial.json().access_token, 'ping')).statusCode).toBe(401)
  })
  it('rotates refresh tokens and persists replay revocation', async () => {
    const state = await authorize(), initial = (await exchange(state)).json()
    const refresh = () => app.inject({ method: 'POST', url: '/api/mcp/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams({ grant_type: 'refresh_token', client_id: state.clientId, refresh_token: initial.refresh_token }).toString() })
    const next = await refresh(); expect(next.statusCode).toBe(200)
    expect((await call(next.json().access_token, 'ping')).statusCode).toBe(200)
    expect((await refresh()).statusCode).toBe(400)
    expect((await call(next.json().access_token, 'ping')).statusCode).toBe(401)
  })
  it('prevents another user revoking an app and honors owner revocation', async () => {
    const state = await authorize(), tokens = (await exchange(state)).json()
    const id = (await pool.query('SELECT id FROM mcp_grants')).rows[0].id
    await app.inject({ method: 'DELETE', url: `/api/mcp/grants/${id}`, headers: browser(otherToken) })
    expect((await call(tokens.access_token, 'ping')).statusCode).toBe(200)
    await app.inject({ method: 'DELETE', url: `/api/mcp/grants/${id}`, headers: browser(userToken) })
    expect((await call(tokens.access_token, 'ping')).statusCode).toBe(401)
  })
  it('persists grant revocation through disabling and re-enabling a user', async () => {
    const state = await authorize(), tokens = (await exchange(state)).json()
    await updateUser({ id: 'user-1', status: 'disabled' })
    await updateUser({ id: 'user-1', status: 'active' })
    expect((await call(tokens.access_token, 'ping')).statusCode).toBe(401)
  })
  it('binds grants to the configured resource even if the public server URL changes', async () => {
    const state = await authorize(), tokens = (await exchange(state)).json(), old = config.MCP_PUBLIC_URL
    config.MCP_PUBLIC_URL = 'https://other.example/api/mcp'
    try { expect((await call(tokens.access_token, 'ping')).statusCode).toBe(401) }
    finally { config.MCP_PUBLIC_URL = old }
  })
  it('blocks Gmail aliases, preserves existing-user control, and excludes admin from batch disable', async () => {
    await pool.query("UPDATE users SET email='a.b+tag@googlemail.com' WHERE id='user-1'")
    await saveRegistrationBlacklist(['ab@gmail.com', 'admin@example.test'])
    await expect(assertRegistrationEmailAllowed('a.b+other@gmail.com')).rejects.toThrow('不允许注册')
    expect((await blacklistMatches()).map(row => row.id)).toEqual(['user-1'])
    expect(await disableBlacklistedUsers(['user-1', 'admin-user'])).toBe(1)
    expect((await pool.query("SELECT status FROM users WHERE id='admin-user'")).rows[0].status).toBe('active')
    await expect(updateUser({ id: 'admin-user', status: 'disabled' })).rejects.toThrow('不能禁用')
  })
  it('deduplicates side effects and rejects cross-policy reuse and uncertain retries', async () => {
    const principal = { actor: 'key:fixture', policy: policySchema.parse({ permissions: ['accounts.import'] }) }
    const work = vi.fn(async () => ({ id: 'created-once' }))
    expect(await idempotentManagement(principal, 'fixture-key-1', 'import', { name: 'one' }, work)).toEqual({ id: 'created-once' })
    expect(await idempotentManagement(principal, 'fixture-key-1', 'import', { name: 'one' }, work)).toEqual({ id: 'created-once' })
    expect(work).toHaveBeenCalledOnce()
    await expect(idempotentManagement(principal, 'fixture-key-1', 'import', { name: 'different' }, work)).rejects.toMatchObject({ statusCode: 409 })
    const uncertain = vi.fn(async () => { throw new Error('upstream accepted but connection closed') })
    await expect(idempotentManagement(principal, 'fixture-key-2', 'reset', {}, uncertain)).rejects.toThrow('upstream accepted')
    await expect(idempotentManagement(principal, 'fixture-key-2', 'reset', {}, uncertain)).rejects.toMatchObject({ statusCode: 409 })
    expect(uncertain).toHaveBeenCalledOnce()
  })
  it('rejects malformed OAuth registration and unsupported privileged tool arguments', async () => {
    const invalid = await app.inject({ method: 'POST', url: '/api/mcp/oauth/register', payload: { client_name: 'bad', redirect_uris: ['http://evil.example/callback'] } })
    expect(invalid.statusCode).toBe(400)
    const state = await authorize(), token = (await exchange(state)).json().access_token
    const result = await call(token, 'tools/call', { name: 'user_list_usage', arguments: { user_id: 'user-2' } })
    expect(result.json().result.isError).toBe(true)
  })
  it('keeps quota reset responses separate from read permission and deduplicates upstream side effects', async () => {
    const writeOnly = await key(['accounts.quota.reset'])
    const request = { method: 'POST' as const, url: '/api/management/accounts/account-a/quota/reset', headers: { ...browser(writeOnly.key), 'idempotency-key': 'quota-response-isolation-001' } }
    const result = await app.inject(request)
    expect(result.statusCode).toBe(200)
    expect(result.json()).toEqual({ id: 'account-a', success: true })
    expect((await app.inject(request)).json()).toEqual({ id: 'account-a', success: true })
    expect(quotaCalls.reset).toHaveBeenCalledOnce()
    const readWrite = await key(['accounts.quota.reset', 'accounts.quota.read'])
    const full = await app.inject({ ...request, headers: { ...request.headers, ...browser(readWrite.key) } })
    expect(full.json()).toMatchObject({ quota: { resetCredits: 7 } })
    await pool.query("UPDATE accounts SET status='disabled' WHERE id='account-a'")
    expect((await app.inject({ method: 'POST', url: '/api/management/accounts/account-a/quota/read', headers: browser(readWrite.key) })).statusCode).toBe(409)
  })
  it('conditionally merges catalog results so older attempts and changed sources cannot overwrite a newer snapshot', async () => {
    await pool.query(`UPDATE accounts SET metadata='{"modelCatalogAttemptAt":20,"modelCatalog":{"models":[{"id":"new"}]},"quota":{"value":1}}'::jsonb WHERE id='account-a'`)
    await updateAccountMetadata('account-a', { modelCatalogAttemptAt: 10, modelCatalog: { models: [{ id: 'stale' }] } }, { attemptAt: 10, provider: 'openai', proxyUrl: null })
    await updateAccountMetadata('account-a', { modelCatalogAttemptAt: 30, modelCatalog: { models: [{ id: 'wrong-source' }] } }, { attemptAt: 30, provider: 'openai', proxyUrl: 'https://different.example' })
    expect((await pool.query("SELECT metadata FROM accounts WHERE id='account-a'")).rows[0].metadata.modelCatalog.models[0].id).toBe('new')
    await updateAccountMetadata('account-a', { modelCatalogAttemptAt: 40, modelCatalogError: 'offline' }, { attemptAt: 40, provider: 'openai', proxyUrl: null })
    await updateAccountMetadata('account-a', { modelCatalogAttemptAt: 35, modelCatalog: { models: [{ id: 'older-success' }] }, modelCatalogError: null }, { attemptAt: 35, provider: 'openai', proxyUrl: null })
    const metadata = (await pool.query("SELECT metadata FROM accounts WHERE id='account-a'")).rows[0].metadata
    expect(metadata).toMatchObject({ modelCatalogError: 'offline', modelCatalog: { models: [{ id: 'new' }] }, quota: { value: 1 } })
  })
  it('bounds stored user-controlled text before serializing MCP results', async () => {
    await pool.query('INSERT INTO usage_logs(id,user_id,provider,model) VALUES($1,$2,$3,$4)', ['oversize-model', 'user-1', 'openai', 'x'.repeat(2 * 1024 * 1024 + 1)])
    const state = await authorize(), token = (await exchange(state)).json().access_token
    const response = await call(token, 'tools/call', { name: 'user_list_usage', arguments: {} })
    const result = response.json().result
    expect(result.isError).not.toBe(true)
    expect(JSON.parse(result.content[0].text).rows[0].model).toHaveLength(200)
    expect(Buffer.byteLength(response.body)).toBeLessThan(10000)
  })
  it('rejects role-less admin tokens and invalidates old sessions after revocation', async () => {
    const missingRole = app.jwt.sign({ sub: 'admin' })
    expect((await app.inject({ method: 'GET', url: '/api/admin/management-keys', headers: browser(missingRole) })).statusCode).toBe(403)
    await revokeAdminSessions()
    expect((await app.inject({ method: 'GET', url: '/api/admin/management-keys', headers: browser(adminToken) })).statusCode).toBe(401)
    const current = app.jwt.sign({ sub: 'admin', role: 'admin', ver: adminSessionVersion() })
    expect((await app.inject({ method: 'GET', url: '/api/admin/management-keys', headers: browser(current) })).statusCode).toBe(200)
  })
})
