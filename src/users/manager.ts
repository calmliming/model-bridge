import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { pool } from '../db/index'
import { microsToUsd } from '../wallet/money'

const INVITE_TTL_MS = 7 * 24 * 60 * 60_000
const BCRYPT_ROUNDS = 10

export class UserManagerError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message)
  }
}

export interface UserView {
  id: string
  email: string
  name: string
  status: 'active' | 'disabled'
  balanceMicros: number
  balance: number
  acceptedAt: number | null
  lastLoginAt: number | null
  createdAt: number
}

export interface UserListRow extends UserView {
  keyCount: number
  requestCount: number
  totalCost: number
}

export interface InviteResult {
  user: UserView
  token: string
  expiresAt: number
}

export interface UserUsageLog {
  id: string
  ts: number
  provider: string
  model: string | null
  status: string
  latencyMs: number | null
  inputTokens: number
  outputTokens: number
  cacheCreateTokens: number
  cacheReadTokens: number
  cost: number
  apiKeyName: string | null
  requestInput: string | null
}

function generateId(): string {
  return randomBytes(12).toString('hex')
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function defaultName(email: string): string {
  return email.split('@')[0] || email
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function hashPassword(password: string): string {
  return bcrypt.hashSync(password, BCRYPT_ROUNDS)
}

function asUser(row: Record<string, unknown>): UserView {
  const balanceMicros = Number(row.balance_micros)
  return {
    id: row.id as string,
    email: row.email as string,
    name: row.name as string,
    status: row.status as 'active' | 'disabled',
    balanceMicros,
    balance: microsToUsd(balanceMicros),
    acceptedAt: row.accepted_at == null ? null : Number(row.accepted_at),
    lastLoginAt: row.last_login_at == null ? null : Number(row.last_login_at),
    createdAt: Number(row.created_at),
  }
}

function asUserListRow(row: Record<string, unknown>): UserListRow {
  return {
    ...asUser(row),
    keyCount: Number(row.key_count ?? 0),
    requestCount: Number(row.request_count ?? 0),
    totalCost: Number(row.total_cost ?? 0),
  }
}

function asUsageLog(row: Record<string, unknown>): UserUsageLog {
  return {
    id: row.id as string,
    ts: Number(row.ts),
    provider: row.provider as string,
    model: (row.model as string | null) ?? null,
    status: row.status as string,
    latencyMs: row.latency_ms == null ? null : Number(row.latency_ms),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    cacheCreateTokens: Number(row.cache_create_tokens),
    cacheReadTokens: Number(row.cache_read_tokens),
    cost: Number(row.cost),
    apiKeyName: (row.api_key_name as string | null) ?? null,
    requestInput: (row.request_input as string | null) ?? null,
  }
}

export async function getUserById(id: string): Promise<UserView | null> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT id, email, name, status, balance_micros, accepted_at, last_login_at, created_at
     FROM users WHERE id = $1`,
    [id],
  )
  return rows[0] ? asUser(rows[0]) : null
}

export async function listUsers(): Promise<UserListRow[]> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT u.id, u.email, u.name, u.status, u.balance_micros, u.accepted_at,
            u.last_login_at, u.created_at,
            (SELECT COUNT(*) FROM api_keys k WHERE k.user_id = u.id) AS key_count,
            (SELECT COUNT(*) FROM usage_logs l WHERE l.user_id = u.id) AS request_count,
            (SELECT COALESCE(SUM(l.cost), 0) FROM usage_logs l WHERE l.user_id = u.id) AS total_cost
     FROM users u
     ORDER BY u.created_at DESC, u.email`,
  )
  return rows.map(asUserListRow)
}

export async function createUserInvite(input: {
  email: string
  name?: string | null
  createdBy?: string | null
}): Promise<InviteResult> {
  const email = normalizeEmail(input.email)
  if (!email) throw new UserManagerError('email is required')
  const name = input.name?.trim() || defaultName(email)
  const token = randomBytes(32).toString('hex')
  const tokenHash = hashToken(token)
  const expiresAt = Date.now() + INVITE_TTL_MS
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query<Record<string, unknown>>(
      'SELECT id, password_hash FROM users WHERE email = $1 FOR UPDATE',
      [email],
    )
    let userId = existing.rows[0]?.id as string | undefined
    if (userId) {
      await client.query('UPDATE users SET name = $1 WHERE id = $2', [name, userId])
    } else {
      userId = generateId()
      await client.query(
        `INSERT INTO users (id, email, name, status, balance_micros)
         VALUES ($1, $2, $3, 'active', 0)`,
        [userId, email, name],
      )
    }
    await client.query(
      'UPDATE user_invites SET accepted_at = $1 WHERE user_id = $2 AND accepted_at IS NULL',
      [Date.now(), userId],
    )
    await client.query(
      `INSERT INTO user_invites (id, user_id, token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [generateId(), userId, tokenHash, expiresAt, input.createdBy ?? null],
    )
    const userRow = await client.query<Record<string, unknown>>(
      `SELECT id, email, name, status, balance_micros, accepted_at, last_login_at, created_at
       FROM users WHERE id = $1`,
      [userId],
    )
    await client.query('COMMIT')
    return { user: asUser(userRow.rows[0]!), token, expiresAt }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function acceptInvite(input: {
  token: string
  password: string
  name?: string | null
}): Promise<UserView> {
  const tokenHash = hashToken(input.token.trim())
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const invite = await client.query<Record<string, unknown>>(
      `SELECT i.id AS invite_id, i.user_id, i.expires_at, i.accepted_at AS invite_accepted_at,
              u.email, u.name, u.status
       FROM user_invites i
       JOIN users u ON u.id = i.user_id
       WHERE i.token_hash = $1
       FOR UPDATE`,
      [tokenHash],
    )
    const row = invite.rows[0]
    if (!row) throw new UserManagerError('invalid invite token', 400)
    if (row.invite_accepted_at != null) throw new UserManagerError('invite already used', 400)
    if (Number(row.expires_at) < Date.now()) throw new UserManagerError('invite expired', 400)
    if (row.status === 'disabled') throw new UserManagerError('user is disabled', 403)

    const userId = row.user_id as string
    const name = input.name?.trim() || (row.name as string)
    const passwordHash = hashPassword(input.password)
    const now = Date.now()
    await client.query(
      `UPDATE users
       SET name = $1, password_hash = $2, accepted_at = COALESCE(accepted_at, $3)
       WHERE id = $4`,
      [name, passwordHash, now, userId],
    )
    await client.query('UPDATE user_invites SET accepted_at = $1 WHERE id = $2', [
      now,
      row.invite_id,
    ])
    const updated = await client.query<Record<string, unknown>>(
      `SELECT id, email, name, status, balance_micros, accepted_at, last_login_at, created_at
       FROM users WHERE id = $1`,
      [userId],
    )
    await client.query('COMMIT')
    return asUser(updated.rows[0]!)
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/**
 * Self-service registration. Creates an active user with a password set, or
 * adopts a pre-created invite-only row that never set a password. Rejects an
 * email that already has a usable password. The `FOR UPDATE` row lock makes
 * concurrent registrations of the same email safe.
 */
export async function registerUser(input: {
  email: string
  password: string
  name?: string | null
}): Promise<UserView> {
  const email = normalizeEmail(input.email)
  if (!email) throw new UserManagerError('email is required')
  const name = input.name?.trim() || defaultName(email)
  const passwordHash = hashPassword(input.password)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query<Record<string, unknown>>(
      'SELECT id, password_hash, status FROM users WHERE email = $1 FOR UPDATE',
      [email],
    )
    const found = existing.rows[0]
    if (found?.password_hash) {
      throw new UserManagerError('该邮箱已被注册', 409)
    }
    const now = Date.now()
    let userId = found?.id as string | undefined
    if (userId) {
      // An invite-only row exists but never set a password — adopt it.
      if (found!.status === 'disabled') throw new UserManagerError('user is disabled', 403)
      await client.query(
        `UPDATE users SET name = $1, password_hash = $2, accepted_at = COALESCE(accepted_at, $3)
         WHERE id = $4`,
        [name, passwordHash, now, userId],
      )
    } else {
      userId = generateId()
      await client.query(
        `INSERT INTO users (id, email, name, password_hash, status, balance_micros, accepted_at)
         VALUES ($1, $2, $3, $4, 'active', 0, $5)`,
        [userId, email, name, passwordHash, now],
      )
    }
    const userRow = await client.query<Record<string, unknown>>(
      `SELECT id, email, name, status, balance_micros, accepted_at, last_login_at, created_at
       FROM users WHERE id = $1`,
      [userId],
    )
    await client.query('COMMIT')
    return asUser(userRow.rows[0]!)
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function verifyUserCredentials(
  emailInput: string,
  password: string,
): Promise<UserView | null> {
  const email = normalizeEmail(emailInput)
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT id, email, name, password_hash, status, balance_micros,
            accepted_at, last_login_at, created_at
     FROM users WHERE email = $1`,
    [email],
  )
  const row = rows[0]
  if (!row?.password_hash || row.status !== 'active') return null
  if (!bcrypt.compareSync(password, row.password_hash as string)) return null
  const now = Date.now()
  await pool.query('UPDATE users SET last_login_at = $1 WHERE id = $2', [now, row.id])
  row.last_login_at = now
  return asUser(row)
}

export async function updateUser(input: {
  id: string
  name?: string
  status?: 'active' | 'disabled'
}): Promise<UserView | null> {
  const patches: string[] = []
  const values: unknown[] = []
  if (input.name !== undefined) {
    values.push(input.name)
    patches.push(`name = $${values.length}`)
  }
  if (input.status !== undefined) {
    values.push(input.status)
    patches.push(`status = $${values.length}`)
  }
  if (!patches.length) return getUserById(input.id)
  values.push(input.id)
  const { rows } = await pool.query<Record<string, unknown>>(
    `UPDATE users SET ${patches.join(', ')}
     WHERE id = $${values.length}
     RETURNING id, email, name, status, balance_micros, accepted_at, last_login_at, created_at`,
    values,
  )
  return rows[0] ? asUser(rows[0]) : null
}

export async function listUserUsage(
  userId: string,
  page = 1,
  pageSize = 20,
): Promise<{ page: number; pageSize: number; total: number; logs: UserUsageLog[] }> {
  const safePage = Math.max(1, Math.floor(Number.isFinite(page) ? page : 1))
  const safePageSize = Math.max(1, Math.min(100, Math.floor(Number.isFinite(pageSize) ? pageSize : 20)))
  const offset = (safePage - 1) * safePageSize
  const [total, logs] = await Promise.all([
    pool.query<Record<string, unknown>>(
      'SELECT COUNT(*) AS total FROM usage_logs WHERE user_id = $1',
      [userId],
    ),
    pool.query<Record<string, unknown>>(
      `SELECT l.id, l.ts, l.provider, l.model, l.status, l.latency_ms,
              l.input_tokens, l.output_tokens, l.cache_create_tokens,
              l.cache_read_tokens, l.cost, l.request_input,
              k.name AS api_key_name
       FROM usage_logs l
       LEFT JOIN api_keys k ON k.id = l.api_key_id
       WHERE l.user_id = $1
       ORDER BY l.ts DESC, l.id DESC
       LIMIT $2 OFFSET $3`,
      [userId, safePageSize, offset],
    ),
  ])
  return {
    page: safePage,
    pageSize: safePageSize,
    total: Number(total.rows[0]?.total ?? 0),
    logs: logs.rows.map(asUsageLog),
  }
}

export interface UserUsageSummary {
  requests24h: number
  tokens24h: number
  cost24h: number
  requests30d: number
  tokens30d: number
  cost30d: number
  requestsTotal: number
  success30d: number
}

const USAGE_MS_PER_DAY = 86_400_000

export async function userUsageSummary(userId: string): Promise<UserUsageSummary> {
  const now = Date.now()
  const since24h = now - USAGE_MS_PER_DAY
  const since30d = now - 30 * USAGE_MS_PER_DAY
  const tokenSum =
    'input_tokens + output_tokens + cache_create_tokens + cache_read_tokens'
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT
       (SELECT COUNT(*) FROM usage_logs WHERE user_id = $1 AND ts >= $2) AS requests24h,
       (SELECT COALESCE(SUM(${tokenSum}), 0) FROM usage_logs WHERE user_id = $1 AND ts >= $2) AS tokens24h,
       (SELECT COALESCE(SUM(cost), 0) FROM usage_logs WHERE user_id = $1 AND ts >= $2) AS cost24h,
       (SELECT COUNT(*) FROM usage_logs WHERE user_id = $1 AND ts >= $3) AS requests30d,
       (SELECT COALESCE(SUM(${tokenSum}), 0) FROM usage_logs WHERE user_id = $1 AND ts >= $3) AS tokens30d,
       (SELECT COALESCE(SUM(cost), 0) FROM usage_logs WHERE user_id = $1 AND ts >= $3) AS cost30d,
       (SELECT COUNT(*) FROM usage_logs WHERE user_id = $1) AS requestsTotal,
       (SELECT COUNT(*) FROM usage_logs WHERE user_id = $1 AND ts >= $3 AND status = 'success') AS success30d`,
    [userId, since24h, since30d],
  )
  const r = rows[0] ?? {}
  const num = (v: unknown): number => {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  return {
    requests24h: num(r.requests24h),
    tokens24h: num(r.tokens24h),
    cost24h: num(r.cost24h),
    requests30d: num(r.requests30d),
    tokens30d: num(r.tokens30d),
    cost30d: num(r.cost30d),
    requestsTotal: num(r.requeststotal),
    success30d: num(r.success30d),
  }
}
