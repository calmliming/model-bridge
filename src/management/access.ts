import { createHash, randomBytes } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import { z } from 'zod'
import { pool } from '../db'
import { checkRateLimit } from '../middleware/limits'
import { accountScope, ipAllowed, policySchema, type ManagementPermission, type ManagementPrincipal } from './permissions'

export const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export const managementError = (message: string, statusCode = 403) => Object.assign(new Error(message), { statusCode })
export const fullPolicy = () => policySchema.parse({ permissions: ['accounts.read', 'accounts.status.write', 'accounts.quota.read', 'accounts.quota.reset', 'accounts.import', 'groups.read', 'users.read', 'usage.read', 'audit.read'] })

export async function authenticateManagement(request: FastifyRequest): Promise<ManagementPrincipal> {
  if (!await checkRateLimit(`management:ip:${request.ip}`, 600)) throw managementError('Too many management authentication attempts', 429)
  const secret = request.headers['x-admin-api-key'] ?? request.headers.authorization?.replace(/^Bearer /i, '')
  if (typeof secret !== 'string' || !secret.startsWith('mb_admin_')) throw managementError('A management API Key is required', 401)
  const { rows } = await pool.query('SELECT id, policy, allowed_ips, expires_at FROM management_keys WHERE key_hash = $1 AND enabled AND revoked_at IS NULL', [digest(secret)])
  const row = rows[0]
  if (!row || (row.expires_at != null && Number(row.expires_at) <= Date.now()) || !ipAllowed(request.ip, row.allowed_ips ?? [])) throw managementError('Invalid management API Key', 401)
  if (!await checkRateLimit(`management:${row.id}`, 120)) throw managementError('Management rate limit exceeded', 429)
  return { actor: `key:${row.id}`, policy: policySchema.parse(row.policy) }
}

export function requirePermission(principal: ManagementPrincipal, permission: ManagementPermission): void {
  if (!principal.policy.permissions.includes(permission)) throw managementError('Operation is outside this credential’s permissions')
}

export async function audit(principal: ManagementPrincipal, operation: string, resource: string | null, status: string): Promise<void> {
  await pool.query('INSERT INTO management_audit(actor, operation, resource_id, status, created_at) VALUES ($1,$2,$3,$4,$5)', [principal.actor, operation.slice(0, 150), resource?.slice(0, 150) ?? null, status, Date.now()])
}

export async function authorizedAccount(principal: ManagementPrincipal, id: string, operational = false): Promise<void> {
  const scope = accountScope(principal.policy, 2)
  const { rows } = await pool.query(`SELECT a.id,a.status,(a.metadata->'reauth'->>'required')='true' AS needs_reauth FROM accounts a WHERE a.id = $1 AND ${scope.sql}`, [id, ...scope.values])
  if (!rows.length) throw managementError('Account not found in the authorized scope', 404)
  if (operational && (rows[0].status === 'disabled' || rows[0].needs_reauth)) throw managementError('Account requires administrator recovery before quota access', 409)
}

export async function createManagementKey(name: string, policy: unknown, allowedIps: string[], expiresAt: number | null) {
  const secret = `mb_admin_${randomBytes(32).toString('base64url')}`
  const id = randomBytes(12).toString('hex')
  await pool.query(`INSERT INTO management_keys(id,name,key_hash,prefix,policy,allowed_ips,expires_at,created_at)
    VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`, [id, name, digest(secret), secret.slice(0, 18), JSON.stringify(policySchema.parse(policy)), JSON.stringify(allowedIps), expiresAt, Date.now()])
  return { id, key: secret }
}

export const paginationSchema = z.object({ page: z.coerce.number().int().min(1).max(100_000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) })
