import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { config } from '../config'
import { pool } from '../db/index'
import { getUserById, UserManagerError, type UserView } from './manager'
import { emailRegistrationConfigured, sendRegistrationCode } from './registrationEmail'

const CODE_TTL_MS = 10 * 60_000
const RESEND_COOLDOWN_MS = 60_000
const MAX_ATTEMPTS = 5

interface PendingRegistration {
  id: string
  name: string
  password_hash: string
  code_hash: string
  expires_at: number
  attempts: number
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function codeDigest(email: string, code: string): string {
  return createHmac('sha256', config.JWT_SECRET).update(`${email}:${code}`).digest('hex')
}

function newCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

function assertConfigured(): void {
  if (!emailRegistrationConfigured()) throw new UserManagerError('邮箱注册暂不可用，请联系管理员配置发件邮箱', 503)
}

async function assertEmailAvailable(email: string): Promise<void> {
  const { rows } = await pool.query<{ password_hash: string | null; google_sub: string | null; status: string }>(
    'SELECT password_hash, google_sub, status FROM users WHERE email = $1', [email],
  )
  const user = rows[0]
  if (user?.status === 'disabled') throw new UserManagerError('该邮箱对应账户已停用', 403)
  if (user?.password_hash || user?.google_sub) throw new UserManagerError('该邮箱已被注册', 409)
}

async function deliverCode(email: string, id: string, code: string): Promise<void> {
  try {
    await sendRegistrationCode(email, code, id)
  } catch {
    await pool.query('DELETE FROM pending_user_registrations WHERE email = $1 AND id = $2', [email, id])
    throw new UserManagerError('验证邮件发送失败，请重新填写注册信息后重试', 503)
  }
}

export async function beginEmailRegistration(input: { email: string; password: string; name?: string }): Promise<{ expiresAt: number; resendAfter: number }> {
  assertConfigured()
  const email = normalizeEmail(input.email)
  await assertEmailAvailable(email)

  const now = Date.now()
  await pool.query('DELETE FROM pending_user_registrations WHERE expires_at <= $1', [now])
  const id = randomBytes(16).toString('hex')
  const code = newCode()
  const passwordHash = await bcrypt.hash(input.password, 10)
  const expiresAt = now + CODE_TTL_MS
  const result = await pool.query<{ id: string }>(`
    INSERT INTO pending_user_registrations (email, id, name, password_hash, code_hash, expires_at, sent_at, attempts, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $7)
    ON CONFLICT (email) DO UPDATE SET
      id = EXCLUDED.id, name = EXCLUDED.name, password_hash = EXCLUDED.password_hash,
      code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at,
      sent_at = EXCLUDED.sent_at, attempts = 0
    WHERE pending_user_registrations.sent_at <= $8
    RETURNING id
  `, [email, id, input.name?.trim() || email.split('@')[0] || email, passwordHash, codeDigest(email, code), expiresAt, now, now - RESEND_COOLDOWN_MS])
  if (!result.rows.length) throw new UserManagerError('验证码发送过于频繁，请稍后再试', 429)
  await deliverCode(email, id, code)
  return { expiresAt, resendAfter: now + RESEND_COOLDOWN_MS }
}

export async function resendEmailRegistrationCode(emailInput: string): Promise<{ expiresAt: number; resendAfter: number }> {
  assertConfigured()
  const email = normalizeEmail(emailInput)
  const now = Date.now()
  const id = randomBytes(16).toString('hex')
  const code = newCode()
  const expiresAt = now + CODE_TTL_MS
  const result = await pool.query<{ id: string }>(`
    UPDATE pending_user_registrations SET id = $2, code_hash = $3, expires_at = $4, sent_at = $5, attempts = 0
    WHERE email = $1 AND sent_at <= $6 AND expires_at > $5
    RETURNING id
  `, [email, id, codeDigest(email, code), expiresAt, now, now - RESEND_COOLDOWN_MS])
  if (!result.rows.length) {
    const pending = await pool.query<{ expires_at: number; sent_at: number }>(
      'SELECT expires_at, sent_at FROM pending_user_registrations WHERE email = $1', [email],
    )
    if (pending.rows[0]?.expires_at && Number(pending.rows[0].expires_at) > now) {
      throw new UserManagerError('验证码发送过于频繁，请稍后再试', 429)
    }
    throw new UserManagerError('注册信息已过期，请重新填写', 400)
  }
  await deliverCode(email, id, code)
  return { expiresAt, resendAfter: now + RESEND_COOLDOWN_MS }
}

export async function verifyEmailRegistration(emailInput: string, code: string): Promise<UserView> {
  assertConfigured()
  const email = normalizeEmail(emailInput)
  const client = await pool.connect()
  let committed = false
  let userId: string
  try {
    await client.query('BEGIN')
    const pendingResult = await client.query<PendingRegistration>(
      'SELECT id, name, password_hash, code_hash, expires_at, attempts FROM pending_user_registrations WHERE email = $1 FOR UPDATE', [email],
    )
    const pending = pendingResult.rows[0]
    if (!pending || Number(pending.expires_at) <= Date.now()) throw new UserManagerError('验证码错误或已过期，请重新注册', 400)
    if (Number(pending.attempts) >= MAX_ATTEMPTS) throw new UserManagerError('验证码尝试次数过多，请重新获取', 429)

    const expected = Buffer.from(pending.code_hash, 'hex')
    const actual = Buffer.from(codeDigest(email, code), 'hex')
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      await client.query('UPDATE pending_user_registrations SET attempts = attempts + 1 WHERE email = $1', [email])
      await client.query('COMMIT')
      committed = true
      throw new UserManagerError('验证码错误或已过期', 400)
    }

    const existing = await client.query<{ id: string; password_hash: string | null; google_sub: string | null; status: string }>(
      'SELECT id, password_hash, google_sub, status FROM users WHERE email = $1 FOR UPDATE', [email],
    )
    const found = existing.rows[0]
    if (found?.status === 'disabled') throw new UserManagerError('该邮箱对应账户已停用', 403)
    if (found?.password_hash || found?.google_sub) throw new UserManagerError('该邮箱已被注册', 409)
    const now = Date.now()
    userId = found?.id ?? randomBytes(12).toString('hex')
    if (found) {
      await client.query(
        'UPDATE users SET name = $1, password_hash = $2, accepted_at = COALESCE(accepted_at, $3) WHERE id = $4',
        [pending.name, pending.password_hash, now, userId],
      )
      await client.query('UPDATE user_invites SET accepted_at = $1 WHERE user_id = $2 AND accepted_at IS NULL', [now, userId])
    } else {
      await client.query(
        "INSERT INTO users (id, email, name, password_hash, status, balance_micros, accepted_at) VALUES ($1, $2, $3, $4, 'active', 0, $5)",
        [userId, email, pending.name, pending.password_hash, now],
      )
    }
    await client.query('DELETE FROM pending_user_registrations WHERE email = $1', [email])
    await client.query('COMMIT')
    committed = true
  } catch (error) {
    if (!committed) await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
  const user = await getUserById(userId!)
  if (!user) throw new Error('verified registration user not found')
  return user
}
