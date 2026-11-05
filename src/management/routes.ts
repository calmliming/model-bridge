import { installManagementErrors } from './errors'
import { idempotentManagement } from './idempotency'
import { blacklistMatches, disableBlacklistedUsers, registrationBlacklist, saveRegistrationBlacklist } from '../users/emailBlacklist'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { pool } from '../db'
import { requireAdmin } from '../middleware/adminAuth'
import { listGroups } from '../accounts/groups'
import { createAccount } from '../accounts/manager'
import { queryOpenAIAccountQuotaReadOnly, resetOpenAIAccountQuota } from '../accounts/openaiQuota'
import { accountScope, permissionIds, policySchema, validIpRule } from './permissions'
import { audit, authenticateManagement, authorizedAccount, createManagementKey, fullPolicy, managementError, paginationSchema, requirePermission } from './access'

export function registerManagementRoutes(app: FastifyInstance): void {
  installManagementErrors(app)
  app.get('/api/admin/registration-email-blacklist', { preHandler: requireAdmin }, async () => ({ emails: await registrationBlacklist() }))
  app.put('/api/admin/registration-email-blacklist', { preHandler: requireAdmin }, async request => {
    const { emails } = z.object({ emails: z.array(z.string()).max(20_000) }).strict().parse(request.body)
    return { emails: await saveRegistrationBlacklist(emails) }
  })
  app.post('/api/admin/registration-email-blacklist/matches', { preHandler: requireAdmin }, async () => ({ users: await blacklistMatches() }))
  app.post('/api/admin/registration-email-blacklist/disable', { preHandler: requireAdmin }, async request => {
    const { ids } = z.object({ ids: z.array(z.string().min(1).max(100)).max(1000), confirm: z.literal(true) }).strict().parse(request.body)
    return { disabled: await disableBlacklistedUsers(ids) }
  })
  app.get('/api/admin/management-keys', { preHandler: requireAdmin }, async () => {
    const { rows } = await pool.query('SELECT id,name,prefix,policy,allowed_ips,expires_at,enabled,version,created_at,revoked_at FROM management_keys ORDER BY created_at DESC LIMIT 1000')
    return { keys: rows, permissions: permissionIds }
  })
  const keySchema = z.object({ name: z.string().trim().min(1).max(100), policy: policySchema,
    allowedIps: z.array(z.string().refine(validIpRule)).max(100).default([]), expiresAt: z.number().int().positive().nullable().default(null) }).strict()
  app.post('/api/admin/management-keys', { preHandler: requireAdmin }, async request => {
    const input = keySchema.parse(request.body)
    const principal = { actor: `admin:${(request.user as { sub?: string }).sub ?? 'admin'}`, policy: fullPolicy() }
    await audit(principal, 'management.keys.create', null, 'requested')
    const created = await createManagementKey(input.name, input.policy, input.allowedIps, input.expiresAt)
    await audit(principal, 'management.keys.create', created.id, 'completed')
    return created
  })
  app.post<{ Params: { id: string } }>('/api/admin/management-keys/:id/rotate', { preHandler: requireAdmin }, async request => {
    // Rotation revokes the old secret in the same transaction as issuing a replacement.
    const { randomBytes } = await import('node:crypto')
    const { digest } = await import('./access')
    const principal = { actor: `admin:${(request.user as { sub?: string }).sub ?? 'admin'}`, policy: fullPolicy() }
    await audit(principal, 'management.keys.rotate', request.params.id, 'requested')
    const secret = `mb_admin_${randomBytes(32).toString('base64url')}`
    const { rows } = await pool.query('UPDATE management_keys SET key_hash=$2,prefix=$3,version=version+1 WHERE id=$1 AND revoked_at IS NULL RETURNING id', [request.params.id, digest(secret), secret.slice(0,18)])
    if (!rows.length) throw managementError('Management key not found', 404)
    await audit(principal, 'management.keys.rotate', request.params.id, 'completed')
    return { id: rows[0].id, key: secret }
  })
  app.delete<{ Params: { id: string } }>('/api/admin/management-keys/:id', { preHandler: requireAdmin }, async request => {
    const principal = { actor: `admin:${(request.user as { sub?: string }).sub ?? 'admin'}`, policy: fullPolicy() }
    await audit(principal, 'management.keys.revoke', request.params.id, 'requested')
    await pool.query('UPDATE management_keys SET enabled=FALSE,revoked_at=$2,version=version+1 WHERE id=$1 AND revoked_at IS NULL', [request.params.id, Date.now()])
    await audit(principal, 'management.keys.revoke', request.params.id, 'completed')
    return { success: true }
  })
  app.get('/api/admin/management-audit', { preHandler: requireAdmin }, async request => {
    const { page, pageSize } = paginationSchema.parse(request.query)
    const { rows } = await pool.query('SELECT * FROM management_audit ORDER BY id DESC LIMIT $1 OFFSET $2', [pageSize, (page - 1) * pageSize])
    return { entries: rows }
  })

  app.get('/api/management/accounts', async request => {
    const principal = await authenticateManagement(request)
    requirePermission(principal, 'accounts.read')
    const { page, pageSize } = paginationSchema.parse(request.query)
    const scope = accountScope(principal.policy)
    await audit(principal, 'accounts.read', null, 'requested')
    const total = await pool.query(`SELECT COUNT(*)::int AS total FROM accounts a WHERE ${scope.sql}`, scope.values)
    const { rows } = await pool.query(`SELECT a.id,LEFT(a.name,200) AS name,a.provider,a.status,a.cooldown_until,a.last_used_at,a.created_at FROM accounts a
      WHERE ${scope.sql} ORDER BY a.created_at DESC LIMIT $3 OFFSET $4`, [...scope.values, pageSize, (page - 1) * pageSize])
    return { accounts: rows, total: total.rows[0]?.total ?? 0, page, pageSize }
  })
  app.patch<{ Params: { id: string } }>('/api/management/accounts/:id/status', async request => {
    const principal = await authenticateManagement(request)
    requirePermission(principal, 'accounts.status.write')
    const { status } = z.object({ status: z.enum(['active', 'disabled']) }).strict().parse(request.body)
    await audit(principal, 'accounts.status.write', request.params.id, 'requested')
    const scope = accountScope(principal.policy, 3)
    const { rows } = await pool.query(`UPDATE accounts a SET status=$2,cooldown_until=NULL WHERE a.id=$1 AND ${scope.sql} RETURNING id`, [request.params.id, status, ...scope.values])
    if (!rows.length) throw managementError('Account not found in the authorized scope', 404)
    await audit(principal, 'accounts.status.write', request.params.id, 'completed')
    return { id: rows[0].id, status }
  })
  for (const action of ['read', 'reset'] as const) {
    app.post<{ Params: { id: string } }>(`/api/management/accounts/:id/quota/${action}`, async request => {
      const principal = await authenticateManagement(request)
      requirePermission(principal, action === 'read' ? 'accounts.quota.read' : 'accounts.quota.reset')
      await authorizedAccount(principal, request.params.id, true)
      await audit(principal, `accounts.quota.${action}`, request.params.id, 'requested')
      const result = action === 'read' ? await queryOpenAIAccountQuotaReadOnly(request.params.id)
        : await idempotentManagement(principal, request.headers['idempotency-key'], 'accounts.quota.reset', { id: request.params.id }, () => resetOpenAIAccountQuota(request.params.id))
      await audit(principal, `accounts.quota.${action}`, request.params.id, 'completed')
      return action === 'reset' && !principal.policy.permissions.includes('accounts.quota.read')
        ? { id: request.params.id, success: true } : { id: request.params.id, quota: result.quota }
    })
  }
  app.get('/api/management/groups', async request => {
    const principal = await authenticateManagement(request)
    requirePermission(principal, 'groups.read')
    await audit(principal, 'groups.read', null, 'requested')
    return { groups: (await listGroups()).filter(group => principal.policy.groupIds === null || principal.policy.groupIds.includes(group.id))
      .map(group => ({ id: group.id, name: group.name })) }
  })
  app.get('/api/management/users', async request => {
    const principal = await authenticateManagement(request)
    requirePermission(principal, 'users.read')
    const { page, pageSize } = paginationSchema.parse(request.query)
    await audit(principal, 'users.read', null, 'requested')
    return { users: (await pool.query('SELECT id,LEFT(email,254) AS email,LEFT(name,200) AS name,status,created_at FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2', [pageSize, (page - 1) * pageSize])).rows, page, pageSize }
  })
  app.get('/api/management/usage', async request => {
    const principal = await authenticateManagement(request)
    requirePermission(principal, 'usage.read')
    const { page, pageSize } = paginationSchema.parse(request.query)
    const scope = accountScope(principal.policy, 1, 'l')
    // Usage resource IDs are upstream account IDs, not log IDs.
    const predicate = scope.sql.replaceAll('l.id', 'l.account_id')
    await audit(principal, 'usage.read', null, 'requested')
    return { logs: (await pool.query(`SELECT l.id,l.ts,l.provider,LEFT(l.model,200) AS model,l.status,l.input_tokens,l.output_tokens,l.cost
      FROM usage_logs l WHERE ${predicate} ORDER BY l.ts DESC LIMIT $3 OFFSET $4`, [...scope.values, pageSize, (page - 1) * pageSize])).rows, page, pageSize }
  })
  app.get('/api/management/audit', async request => {
    const principal = await authenticateManagement(request)
    requirePermission(principal, 'audit.read')
    const { page, pageSize } = paginationSchema.parse(request.query)
    await audit(principal, 'audit.read', null, 'requested')
    return { entries: (await pool.query('SELECT * FROM management_audit ORDER BY id DESC LIMIT $1 OFFSET $2', [pageSize, (page - 1) * pageSize])).rows, page, pageSize }
  })
  app.post('/api/management/accounts/import', async request => {
    const principal = await authenticateManagement(request)
    requirePermission(principal, 'accounts.import')
    const input = z.object({ name: z.string().trim().min(1).max(100), provider: z.enum(['openai', 'claude', 'gemini', 'grok', 'sub2api', 'deepseek', 'kimi', 'zhipu', 'qwen', 'minimax', 'xiaomi']),
      accessToken: z.string().min(1).max(100_000), refreshToken: z.string().max(100_000).default(''), expiresAt: z.number().int().nonnegative().default(0),
      chatgptAccountId: z.string().regex(/^[\w-]{1,200}$/).optional(),
      groupIds: z.array(z.string().min(1).max(100)).max(100).default([]) }).strict().parse(request.body)
    if (principal.policy.accountIds !== null || (principal.policy.groupIds !== null && (!input.groupIds.length || input.groupIds.some(id => !principal.policy.groupIds!.includes(id))))) throw managementError('Target groups are outside the import scope')
    await audit(principal, 'accounts.import', null, 'requested')
    const result = await idempotentManagement(principal, request.headers['idempotency-key'], 'accounts.import', input,
      () => createAccount({ provider: input.provider, name: input.name, tokens: { accessToken: input.accessToken, refreshToken: input.refreshToken, expiresAt: input.expiresAt,
        ...(input.provider === 'openai' && input.chatgptAccountId ? { metadata: { openai: { chatgptAccountId: input.chatgptAccountId } } } : {}) }, groupIds: input.groupIds }))
    await audit(principal, 'accounts.import', result.id, 'completed')
    return { id: result.id }
  })
}
