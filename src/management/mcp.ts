import { installManagementErrors } from './errors'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { config } from '../config'
import { getSystemVersionInfo } from '../system/version'
import { pool } from '../db'
import { checkRateLimit } from '../middleware/limits'
import { validAdminSessionVersion } from '../auth/sessionVersion'
import { getAdminUserId, getAdminUsername } from '../auth/admin'
import { audit, digest, fullPolicy, managementError, paginationSchema } from './access'

const random = (prefix: string) => prefix + randomBytes(32).toString('base64url')
const loopback = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host)
export function validMcpUrl(value: string): boolean {
  try { const u = new URL(value); return (u.protocol === 'https:' || (u.protocol === 'http:' && loopback(u.hostname))) && u.pathname === '/api/mcp' && !u.username && !u.password && !u.search && !u.hash }
  catch { return false }
}
export function validRedirect(value: string): boolean {
  try { const u = new URL(value); return (u.protocol === 'https:' || (u.protocol === 'http:' && loopback(u.hostname))) && !u.username && !u.password && !u.hash && !value.includes('*') }
  catch { return false }
}
const clientSchema = z.object({ client_name: z.string().trim().min(1).max(100).refine(v => !/[\p{C}<>]/u.test(v)), redirect_uris: z.array(z.string().max(2000).refine(validRedirect)).min(1).max(5), token_endpoint_auth_method: z.literal('none').default('none') })
type Client = z.infer<typeof clientSchema>
function signClient(client: Client): string {
  const body = Buffer.from(JSON.stringify(client)).toString('base64url')
  return `${body}.${createHmac('sha256', config.JWT_SECRET).update('mcp-client:' + body).digest('base64url')}`
}
export function readMcpClient(id: string): Client {
  if (id.length > 16000) throw managementError('Invalid OAuth client', 400)
  const parts = id.split('.')
  if (parts.length !== 2) throw managementError('Invalid OAuth client', 400)
  const [body, signature] = parts as [string, string]
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) throw managementError('Invalid OAuth client', 400)
  const expected = createHmac('sha256', config.JWT_SECRET).update('mcp-client:' + body).digest()
  const actual = Buffer.from(signature, 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw managementError('Invalid OAuth client', 400)
  return clientSchema.parse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')))
}
function resource(): string {
  if (!config.MCP_PUBLIC_URL || !validMcpUrl(config.MCP_PUBLIC_URL)) throw managementError('MCP is not enabled', 503)
  return config.MCP_PUBLIC_URL
}
type Identity = { id: string; role: 'admin' | 'user'; fingerprint: string }
async function identityFor(id: string, role: 'admin' | 'user', connection: Pick<typeof pool, 'query'> = pool): Promise<Identity> {
  const { rows } = await connection.query('SELECT id,email,password_hash,google_sub,status FROM users WHERE id=$1', [id])
  const row = rows[0]
  const adminId = role === 'admin' ? (await connection.query("SELECT value FROM settings WHERE key='admin.user_id'")).rows[0]?.value : null
  if (!row || row.status !== 'active' || (role === 'admin' && id !== adminId)) throw managementError('Authorization owner is no longer active', 401)
  let credential = `${row.email}:${row.password_hash ?? ''}:${row.google_sub ?? ''}`
  if (role === 'admin') {
    const admin = await connection.query("SELECT value FROM settings WHERE key='admin.password_hash'")
    credential += ':' + (admin.rows[0]?.value ?? '')
  }
  return { id, role, fingerprint: digest(credential) }
}
async function browserIdentity(request: FastifyRequest): Promise<Identity> {
  try { await request.jwtVerify() } catch { throw managementError('Please sign in to authorize MCP', 401) }
  const payload = request.user as { role?: string; sub?: string; ver?: number }
  if (payload.role === 'admin') {
    if (!validAdminSessionVersion(payload.ver) || payload.sub !== await getAdminUsername()) throw managementError('Admin session has expired', 401)
    const id = await getAdminUserId()
    if (!id) throw managementError('Admin user is unavailable', 401)
    return identityFor(id, 'admin')
  }
  if (payload.role !== 'user' || !payload.sub) throw managementError('User session required', 401)
  return identityFor(payload.sub, 'user')
}
const authorizationSchema = z.object({ client_id: z.string().max(16000), redirect_uri: z.string().max(2000), resource: z.string(), response_type: z.literal('code'),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/), code_challenge_method: z.literal('S256'), state: z.string().max(2048).optional(), scope: z.literal('mcp.read').default('mcp.read') })
function authorization(input: unknown) {
  const value = authorizationSchema.parse(input)
  const client = readMcpClient(value.client_id)
  if (value.resource !== resource() || !client.redirect_uris.includes(value.redirect_uri)) throw managementError('OAuth redirect or resource does not match registration', 400)
  return { value, client }
}
async function verifyGrant(row: Record<string, any>, connection: Pick<typeof pool, 'query'> = pool): Promise<Identity> {
  if (!row || row.revoked_at || Number(row.expires_at) <= Date.now() || row.resource !== resource()) throw managementError('OAuth grant expired or revoked', 401)
  const identity = await identityFor(row.user_id, row.role, connection)
  if (identity.fingerprint !== row.fingerprint) throw managementError('OAuth grant credentials changed', 401)
  return identity
}

const toolDefinitions = [
  { name: 'user_get_profile', description: '查看自己的资料、余额与账户状态。', admin: false },
  { name: 'user_list_usage', description: '分页查询自己的请求与计费记录。', admin: false },
  { name: 'user_list_api_keys', description: '查看自己的 Key 名称和限额，不返回密钥。', admin: false },
  { name: 'user_list_subscriptions', description: '查看自己的订阅和有效期。', admin: false },
  { name: 'admin_list_accounts', description: '管理员分页查看上游账号状态，不返回凭据。', admin: true },
  { name: 'admin_usage_summary', description: '管理员查看平台请求与用量总览。', admin: true },
]
async function executeTool(identity: Identity, name: string, args: unknown) {
  const definition = toolDefinitions.find(tool => tool.name === name && (!tool.admin || identity.role === 'admin'))
  if (!definition) throw managementError('Tool is outside this grant’s scope')
  const { page, pageSize } = paginationSchema.strict().parse(args ?? {})
  const principal = { actor: `mcp:${identity.id}`, policy: fullPolicy() }
  await audit(principal, name, identity.id, 'requested')
  let rows: unknown[]
  if (name === 'user_get_profile') rows = (await pool.query('SELECT id,LEFT(email,254) AS email,LEFT(name,200) AS name,status,balance_micros FROM users WHERE id=$1', [identity.id])).rows
  else if (name === 'user_list_usage') rows = (await pool.query('SELECT id,ts,provider,LEFT(model,200) AS model,status,input_tokens,output_tokens,cost FROM usage_logs WHERE user_id=$1 ORDER BY ts DESC LIMIT $2 OFFSET $3', [identity.id, pageSize, (page - 1) * pageSize])).rows
  else if (name === 'user_list_api_keys') rows = (await pool.query('SELECT id,LEFT(name,200) AS name,enabled,quota_limit,quota_used,expires_at FROM api_keys WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3', [identity.id, pageSize, (page - 1) * pageSize])).rows
  else if (name === 'user_list_subscriptions') rows = (await pool.query('SELECT id,plan_id,group_id,status,starts_at,expires_at FROM user_subscriptions WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3', [identity.id, pageSize, (page - 1) * pageSize])).rows
  else if (name === 'admin_list_accounts') rows = (await pool.query('SELECT id,LEFT(name,200) AS name,provider,status,cooldown_until FROM accounts ORDER BY created_at DESC LIMIT $1 OFFSET $2', [pageSize, (page - 1) * pageSize])).rows
  else rows = (await pool.query('SELECT COUNT(*)::bigint AS requests, COALESCE(SUM(cost),0) AS cost FROM usage_logs')).rows
  await audit(principal, name, identity.id, 'completed')
  const text = JSON.stringify({ rows, page, pageSize })
  if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw managementError('Result too large; reduce pageSize', 413)
  return { content: [{ type: 'text', text }] }
}

export function registerMcpRoutes(app: FastifyInstance): void {
  installManagementErrors(app)
  app.addHook('onRequest', async (request, reply) => {
    if (!(request.url.startsWith('/api/mcp') || request.url.startsWith('/.well-known/oauth'))) return
    reply.header('Cache-Control', 'no-store')
    if (request.url.startsWith('/api/mcp/config') || request.url.startsWith('/api/mcp/grants')) return
    const url = resource()
    const origin = request.headers.origin
    const allowed = [new URL(url).origin, config.MCP_FRONTEND_URL ? new URL(config.MCP_FRONTEND_URL).origin : new URL(url).origin]
    if (origin && !allowed.includes(origin)) throw managementError('Origin is not allowed')
    if (origin) reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin')
    if (!await checkRateLimit(`mcp:ip:${request.ip}`, 600)) throw managementError('MCP rate limit exceeded', 429)
  })
  app.options('/api/mcp', async (_request, reply) => reply.header('Access-Control-Allow-Methods', 'POST,GET,DELETE,OPTIONS')
    .header('Access-Control-Allow-Headers', 'Authorization,Content-Type,Accept,MCP-Protocol-Version').code(204).send())
  app.get('/.well-known/oauth-protected-resource/api/mcp', async () => ({ resource: resource(), authorization_servers: [new URL(resource()).origin], scopes_supported: ['mcp.read'] }))
  app.get('/.well-known/oauth-protected-resource', async () => ({ resource: resource(), authorization_servers: [new URL(resource()).origin], scopes_supported: ['mcp.read'] }))
  app.get('/.well-known/oauth-authorization-server', async () => {
    const origin = new URL(resource()).origin
    return { issuer: origin, authorization_endpoint: `${origin}/api/mcp/oauth/authorize`, token_endpoint: `${origin}/api/mcp/oauth/token`, registration_endpoint: `${origin}/api/mcp/oauth/register`, revocation_endpoint: `${origin}/api/mcp/oauth/revoke`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: ['mcp.read'] }
  })
  app.post('/api/mcp/oauth/register', { bodyLimit: 16 * 1024 }, async (request, reply) => {
    if (!await checkRateLimit(`mcp:register:${request.ip}`, 20)) throw managementError('Registration rate limit exceeded', 429)
    const client = clientSchema.parse(request.body)
    return reply.code(201).send({ ...client, client_id: signClient(client), grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] })
  })
  app.get('/api/mcp/oauth/authorize', async (request, reply) => {
    const { value } = authorization(request.query)
    const frontend = new URL('/mcp/authorize', config.MCP_FRONTEND_URL ?? new URL(resource()).origin)
    for (const [key, item] of Object.entries(value)) if (item !== undefined) frontend.searchParams.set(key, item)
    return reply.redirect(frontend.toString())
  })
  app.get('/api/mcp/config', async request => {
    await browserIdentity(request)
    return { url: config.MCP_PUBLIC_URL ?? null, readOnly: true }
  })
  app.post('/api/mcp/oauth/preview', async request => {
    const identity = await browserIdentity(request)
    const { client, value } = authorization(request.body)
    return { clientName: client.client_name, redirectUri: value.redirect_uri, role: identity.role, readOnly: true }
  })
  app.post('/api/mcp/oauth/consent', async request => {
    const identity = await browserIdentity(request)
    const input = z.object({ authorization: authorizationSchema, allow: z.boolean(), adminScope: z.boolean().default(false) }).strict().parse(request.body)
    const { value, client } = authorization(input.authorization)
    const target = new URL(value.redirect_uri)
    if (value.state !== undefined) target.searchParams.set('state', value.state)
    if (!input.allow) { target.searchParams.set('error', 'access_denied'); return { redirect: target.toString() } }
    if (input.adminScope && identity.role !== 'admin') throw managementError('Administrator scope requires an administrator')
    const role = input.adminScope ? 'admin' : 'user'
    const id = randomBytes(12).toString('hex'), code = random('mb_mcp_code_'), now = Date.now()
    const db = await pool.connect()
    try {
      await db.query('BEGIN')
      // Serialize with disable operations, preventing an in-flight consent from reviving access.
      const owner = await db.query('SELECT status FROM users WHERE id=$1 FOR UPDATE', [identity.id])
      if (owner.rows[0]?.status !== 'active') throw managementError('User is disabled', 401)
      await db.query('DELETE FROM mcp_token_history WHERE expires_at < $1', [now])
      await db.query('DELETE FROM mcp_grants WHERE user_id=$1 AND expires_at < $2', [identity.id, now - 7 * 86_400_000])
      const count = await db.query('SELECT COUNT(*)::int AS count FROM mcp_grants WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>$2', [identity.id, now])
      if (Number(count.rows[0]?.count ?? 0) >= 20) throw managementError('Revoke an existing application before adding another', 409)
      // Personal grants from an admin use the same user credential fingerprint.
      const fingerprint = (await identityFor(identity.id, role, db)).fingerprint
      await db.query(`INSERT INTO mcp_grants(id,user_id,role,fingerprint,client_id,client_name,redirect_uri,challenge,code_hash,created_at,expires_at,resource)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [id, identity.id, role, fingerprint, value.client_id, client.client_name, value.redirect_uri, value.code_challenge, digest(code), now, now + 30 * 86_400_000, resource()])
      await db.query('COMMIT')
    } catch (error) { await db.query('ROLLBACK').catch(() => {}); throw error }
    finally { db.release() }
    target.searchParams.set('code', code)
    return { redirect: target.toString() }
  })
  app.post('/api/mcp/oauth/token', { bodyLimit: 32 * 1024 }, async (request, reply) => {
    const input = z.object({ grant_type: z.enum(['authorization_code', 'refresh_token']), client_id: z.string().max(16000), code: z.string().max(200).optional(), redirect_uri: z.string().max(2000).optional(), code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/).optional(), refresh_token: z.string().max(200).optional(), resource: z.string().optional() }).parse(request.body)
    readMcpClient(input.client_id)
    if (input.resource !== undefined && input.resource !== resource()) return reply.code(400).send({ error: 'invalid_target' })
    if (input.grant_type === 'authorization_code' && input.resource !== resource()) return reply.code(400).send({ error: 'invalid_target' })
    const token = input.grant_type === 'authorization_code' ? input.code : input.refresh_token
    if (!token) return reply.code(400).send({ error: 'invalid_grant' })
    const db = await pool.connect()
    try {
      await db.query('BEGIN')
      const column = input.grant_type === 'authorization_code' ? 'code_hash' : 'refresh_hash'
      const result = await db.query(`SELECT * FROM mcp_grants WHERE ${column}=$1 FOR UPDATE`, [digest(token)])
      const row = result.rows[0]
      if (!row) {
        const previous = await db.query('SELECT grant_id FROM mcp_token_history WHERE token_hash=$1', [digest(token)])
        if (previous.rows[0]) await db.query('UPDATE mcp_grants SET revoked_at=$2 WHERE id=$1', [previous.rows[0].grant_id, Date.now()])
        await db.query('COMMIT')
        return reply.code(400).send({ error: 'invalid_grant' })
      }
      if (row.client_id !== input.client_id) throw managementError('OAuth client mismatch', 400)
      await verifyGrant(row, db)
      if (input.grant_type === 'authorization_code') {
        if (row.code_used) {
          await db.query('UPDATE mcp_grants SET revoked_at=$2 WHERE id=$1', [row.id, Date.now()])
          await db.query('COMMIT')
          return reply.code(400).send({ error: 'invalid_grant' })
        }
        if (Number(row.created_at) + 300_000 < Date.now() || row.redirect_uri !== input.redirect_uri || !input.code_verifier || digestVerifier(input.code_verifier) !== row.challenge) throw managementError('OAuth code verification failed', 400)
      }
      const access = random('mb_mcp_access_'), refresh = random('mb_mcp_refresh_'), now = Date.now()
      if (row.refresh_hash) await db.query('INSERT INTO mcp_token_history(token_hash,grant_id,expires_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [row.refresh_hash, row.id, Number(row.expires_at)])
      await db.query('UPDATE mcp_grants SET code_used=TRUE,access_hash=$2,access_expires_at=$3,refresh_hash=$4 WHERE id=$1', [row.id, digest(access), now + 600_000, digest(refresh)])
      await db.query('COMMIT')
      return { access_token: access, token_type: 'Bearer', expires_in: 600, refresh_token: refresh, scope: 'mcp.read' }
    } catch { await db.query('ROLLBACK').catch(() => {}); return reply.code(400).send({ error: 'invalid_grant' }) }
    finally { db.release() }
  })
  app.post('/api/mcp/oauth/revoke', { bodyLimit: 32 * 1024 }, async request => {
    const input = z.object({ token: z.string().max(200), client_id: z.string().max(16000) }).parse(request.body)
    readMcpClient(input.client_id)
    await pool.query('UPDATE mcp_grants SET revoked_at=$3 WHERE client_id=$1 AND (access_hash=$2 OR refresh_hash=$2 OR code_hash=$2)', [input.client_id, digest(input.token), Date.now()])
    return {}
  })
  app.get('/api/mcp/grants', async request => {
    const identity = await browserIdentity(request)
    return { grants: (await pool.query('SELECT id,client_name,role,created_at,expires_at,revoked_at FROM mcp_grants WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [identity.id])).rows }
  })
  app.delete<{ Params: { id: string } }>('/api/mcp/grants/:id', async request => {
    const identity = await browserIdentity(request)
    await pool.query('UPDATE mcp_grants SET revoked_at=$3 WHERE id=$1 AND user_id=$2', [request.params.id, identity.id, Date.now()])
    return { success: true }
  })
  for (const method of ['GET', 'DELETE'] as const) app.route({ method, url: '/api/mcp', handler: (_request, reply) => reply.header('Allow', 'POST').code(405).send() })
  app.post('/api/mcp', { bodyLimit: 64 * 1024 }, async (request, reply) => {
    const authorization = request.headers.authorization
    const secret = authorization?.match(/^Bearer (mb_mcp_access_[A-Za-z0-9_-]+)$/)?.[1]
    const unauthorized = () => reply.header('WWW-Authenticate', `Bearer resource_metadata="${new URL(resource()).origin}/.well-known/oauth-protected-resource/api/mcp", scope="mcp.read"`).code(401).send({ error: 'invalid_token' })
    if (!secret) return unauthorized()
    const { rows } = await pool.query('SELECT * FROM mcp_grants WHERE access_hash=$1 AND access_expires_at>$2', [digest(secret), Date.now()])
    let identity: Identity
    try { identity = await verifyGrant(rows[0]) } catch { return unauthorized() }
    if (!await checkRateLimit(`mcp:user:${identity.id}`, 120)) throw managementError('MCP user rate limit exceeded', 429)
    const version = request.headers['mcp-protocol-version']
    if (version && !['2025-03-26', '2025-06-18', '2025-11-25'].includes(String(version))) return reply.code(400).send({ error: 'Unsupported MCP protocol version' })
    const message = z.object({ jsonrpc: z.literal('2.0'), id: z.union([z.string().max(100), z.number().finite()]).optional(), method: z.string().max(100), params: z.record(z.unknown()).optional() }).strict().safeParse(request.body)
    if (!message.success) return reply.code(400).send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid JSON-RPC request' } })
    const { id, method, params } = message.data
    if (id === undefined) return reply.code(202).send()
    let result: unknown
    if (method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'model-bridge', version: getSystemVersionInfo().version ?? 'development' } }
    else if (method === 'ping') result = {}
    else if (method === 'tools/list') result = { tools: toolDefinitions.filter(tool => !tool.admin || identity.role === 'admin').map(({ admin: _admin, ...tool }) => ({ ...tool, annotations: { readOnlyHint: true, destructiveHint: false }, inputSchema: { type: 'object', properties: { page: { type: 'integer', minimum: 1, maximum: 100000 }, pageSize: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false } })) }
    else if (method === 'tools/call') {
      try { const call = z.object({ name: z.string(), arguments: z.record(z.unknown()).optional() }).strict().parse(params); result = await executeTool(identity, call.name, call.arguments) }
      catch (error) { result = { isError: true, content: [{ type: 'text', text: typeof (error as { statusCode?: number }).statusCode === 'number' ? (error as Error).message : 'Tool temporarily unavailable or arguments invalid.' }] } }
    } else return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }
    return { jsonrpc: '2.0', id, result }
  })
}
export function digestVerifier(value: string): string { return Buffer.from(digest(value), 'hex').toString('base64url') }
