import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { config } from '../config'
import { pool } from '../db/index'
import { getSetting, setSetting } from '../db/settings'

const USERNAME_KEY = 'admin.username'
const PASSWORD_HASH_KEY = 'admin.password_hash'
const ADMIN_USER_ID_KEY = 'admin.user_id'
const BCRYPT_ROUNDS = 10
const ADMIN_USER_EMAIL = 'admin@model-bridge.local'

function generateId(): string {
  return randomBytes(12).toString('hex')
}

function adminUserEmail(username: string): string {
  const normalized = username.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : ADMIN_USER_EMAIL
}

/** Creates the admin account from env config on first run. */
export async function ensureAdmin(): Promise<void> {
  let passwordHash = await getSetting(PASSWORD_HASH_KEY)
  if (!passwordHash) {
    passwordHash = bcrypt.hashSync(config.ADMIN_PASSWORD, BCRYPT_ROUNDS)
    await setSetting(USERNAME_KEY, config.ADMIN_USERNAME)
    await setSetting(PASSWORD_HASH_KEY, passwordHash)
    console.log(`[auth] created admin account "${config.ADMIN_USERNAME}"`)
    if (config.ADMIN_PASSWORD === 'admin') {
      console.warn('[auth] WARNING: admin password is the default "admin" — change it in Settings')
    }
  }
  await ensureAdminUser(passwordHash)
}

export async function getAdminUsername(): Promise<string> {
  return (await getSetting(USERNAME_KEY)) ?? config.ADMIN_USERNAME
}

export async function getAdminUserId(): Promise<string | null> {
  return (await getSetting(ADMIN_USER_ID_KEY)) ?? null
}

/**
 * Mirrors the admin login into the customer-user table so admin-owned API keys
 * can be billed through the same wallet/usage path as normal users.
 */
export async function ensureAdminUser(passwordHash?: string): Promise<string | null> {
  const storedHash = passwordHash ?? (await getSetting(PASSWORD_HASH_KEY))
  if (!storedHash) return null

  const username = await getAdminUsername()
  const email = adminUserEmail(username)
  const now = Date.now()
  const configuredId = await getAdminUserId()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    let userId = configuredId
    if (userId) {
      const existing = await client.query<Record<string, unknown>>(
        'SELECT id FROM users WHERE id = $1 FOR UPDATE',
        [userId],
      )
      if (!existing.rows[0]) userId = null
    }

    if (!userId) {
      const byEmail = await client.query<Record<string, unknown>>(
        'SELECT id FROM users WHERE email = $1 FOR UPDATE',
        [email],
      )
      userId = (byEmail.rows[0]?.id as string | undefined) ?? null
    }

    if (userId) {
      await client.query(
        `UPDATE users
         SET name = $1, password_hash = $2, status = 'active', accepted_at = COALESCE(accepted_at, $3)
         WHERE id = $4`,
        [username, storedHash, now, userId],
      )
    } else {
      userId = generateId()
      await client.query(
        `INSERT INTO users (id, email, name, password_hash, status, balance_micros, accepted_at)
         VALUES ($1, $2, $3, $4, 'active', 0, $5)`,
        [userId, email, username, storedHash, now],
      )
    }

    await client.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [ADMIN_USER_ID_KEY, userId],
    )
    await client.query(
      `UPDATE api_keys
       SET user_id = $1, owner_label = COALESCE(owner_label, $2)
       WHERE user_id IS NULL`,
      [userId, username],
    )
    await client.query('COMMIT')
    return userId
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** Verifies a username/password pair against the stored admin credentials. */
export async function verifyAdminCredentials(username: string, password: string): Promise<boolean> {
  const storedHash = await getSetting(PASSWORD_HASH_KEY)
  if (!storedHash || username !== (await getAdminUsername())) return false
  return bcrypt.compareSync(password, storedHash)
}

/** Changes the admin password after verifying the current one. */
export async function changeAdminPassword(currentPassword: string, newPassword: string): Promise<boolean> {
  const storedHash = await getSetting(PASSWORD_HASH_KEY)
  if (!storedHash || !bcrypt.compareSync(currentPassword, storedHash)) return false
  const nextHash = bcrypt.hashSync(newPassword, BCRYPT_ROUNDS)
  await setSetting(PASSWORD_HASH_KEY, nextHash)
  await ensureAdminUser(nextHash)
  return true
}
