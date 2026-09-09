import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { pool } from '../db/index'
import { getUserById, UserManagerError, type UserView } from './manager'
import type { GoogleIdentity } from '../auth/google'

export class GoogleLinkRequiredError extends UserManagerError {
  constructor() { super('该邮箱已有账号，请输入原账号密码以绑定 Google', 409) }
}

export async function signInGoogleUser(input: {
  identity: GoogleIdentity
  registrationEnabled: boolean
  password?: string
  // Consume proof after all account checks, but before making changes. A failed
  // password confirmation can retry; a successful proof cannot be replayed.
  consumeProof: () => Promise<void>
}): Promise<UserView> {
  const { identity } = input
  const email = identity.email.trim().toLowerCase()
  const client = await pool.connect()
  let userId: string
  try {
    await client.query('BEGIN')
    // Serializes simultaneous first logins even before a user row exists.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`google:${identity.sub}`])
    const linked = await client.query('SELECT * FROM users WHERE google_sub = $1 FOR UPDATE', [identity.sub])
    let row = linked.rows[0]
    if (!row) {
      const existing = await client.query('SELECT * FROM users WHERE email = $1 FOR UPDATE', [email])
      row = existing.rows[0]
      if (row?.status === 'disabled') throw new UserManagerError('账号已停用，请联系管理员', 403)
      if (row?.google_sub) throw new UserManagerError('该邮箱已绑定其他 Google 账号', 409)
      if (row) {
        if (!row.password_hash) throw new UserManagerError('请先通过邀请链接设置账号密码，再绑定 Google', 409)
        if (!input.password) throw new GoogleLinkRequiredError()
        if (!bcrypt.compareSync(input.password, row.password_hash)) throw new UserManagerError('原账号密码不正确', 400)
      } else if (!input.registrationEnabled) {
        throw new UserManagerError('当前未开放注册，请联系管理员邀请', 403)
      }
    }
    if (row?.status !== undefined && row.status !== 'active') {
      throw new UserManagerError('账号已停用，请联系管理员', 403)
    }
    await input.consumeProof()
    const now = Date.now()
    if (row) {
      userId = row.id
      await client.query(
        `UPDATE users SET google_sub = $1, last_login_at = $2, accepted_at = COALESCE(accepted_at, $2)
         WHERE id = $3`, [identity.sub, now, userId],
      )
    } else {
      userId = randomBytes(12).toString('hex')
      await client.query(
        `INSERT INTO users (id, email, name, google_sub, status, balance_micros, accepted_at, last_login_at)
         VALUES ($1, $2, $3, $4, 'active', 0, $5, $5)`,
        [userId, email, identity.name?.trim().slice(0, 60) || email.split('@')[0], identity.sub, now],
      )
    }
    // A stale invitation must not allow resetting the newly linked account.
    await client.query('UPDATE user_invites SET accepted_at = $1 WHERE user_id = $2 AND accepted_at IS NULL', [now, userId])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      throw new UserManagerError('该账号刚刚完成注册或绑定，请重新登录', 409)
    }
    throw error
  } finally {
    client.release()
  }
  const user = await getUserById(userId)
  if (!user || user.status !== 'active') throw new UserManagerError('账号已停用或不存在', 403)
  return user
}
