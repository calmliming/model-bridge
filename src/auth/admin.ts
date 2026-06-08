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
const LEGACY_ADMIN_USER_EMAIL = 'admin-wallet@model-bridge.local'

interface AdminUserCandidate {
  id: string
  email: string
  balanceMicros: number
  keyCount: number
  usageCount: number
  walletCount: number
  paymentCount: number
  subscriptionCount: number
  inviteCount: number
}

function generateId(): string {
  return randomBytes(12).toString('hex')
}

function adminUserEmail(username: string): string {
  const normalized = username.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : ADMIN_USER_EMAIL
}

function candidateActivity(candidate: AdminUserCandidate): number {
  return (
    Math.abs(candidate.balanceMicros) +
    candidate.keyCount +
    candidate.usageCount +
    candidate.walletCount +
    candidate.paymentCount +
    candidate.subscriptionCount
  )
}

function asAdminCandidate(row: Record<string, unknown>): AdminUserCandidate {
  return {
    id: row.id as string,
    email: row.email as string,
    balanceMicros: Number(row.balance_micros ?? 0),
    keyCount: Number(row.key_count ?? 0),
    usageCount: Number(row.usage_count ?? 0),
    walletCount: Number(row.wallet_count ?? 0),
    paymentCount: Number(row.payment_count ?? 0),
    subscriptionCount: Number(row.subscription_count ?? 0),
    inviteCount: Number(row.invite_count ?? 0),
  }
}

function pickAdminUser(
  candidates: AdminUserCandidate[],
  configuredId: string | null,
  email: string,
): AdminUserCandidate | null {
  const byId = (id: string | null) => candidates.find((c) => id && c.id === id) ?? null
  const legacy = candidates.find((c) => c.email === LEGACY_ADMIN_USER_EMAIL) ?? null
  const configured = byId(configuredId)
  const matchingEmail = candidates.find((c) => c.email === email) ?? null

  // Existing deployments may already have an "admin wallet" user that owns
  // all historical keys. Prefer that row over a newly-created empty mirror.
  if (legacy && candidateActivity(legacy) > 0) return legacy
  if (configured) return configured
  return matchingEmail ?? legacy ?? null
}

async function listAdminUserCandidates(
  client: { query: typeof pool.query },
  configuredId: string | null,
  email: string,
): Promise<AdminUserCandidate[]> {
  const { rows } = await client.query<Record<string, unknown>>(
    `SELECT u.id, u.email, u.balance_micros,
            (SELECT COUNT(*) FROM api_keys k WHERE k.user_id = u.id) AS key_count,
            (SELECT COUNT(*) FROM usage_logs l WHERE l.user_id = u.id) AS usage_count,
            (SELECT COUNT(*) FROM wallet_transactions w WHERE w.user_id = u.id) AS wallet_count,
            (SELECT COUNT(*) FROM payment_orders p WHERE p.user_id = u.id) AS payment_count,
            (SELECT COUNT(*) FROM user_subscriptions s WHERE s.user_id = u.id) AS subscription_count,
            (SELECT COUNT(*) FROM user_invites i WHERE i.user_id = u.id) AS invite_count
     FROM users u
     WHERE ($1::TEXT IS NOT NULL AND u.id = $1)
        OR u.email = $2
        OR u.email = $3
     FOR UPDATE OF u`,
    [configuredId, email, LEGACY_ADMIN_USER_EMAIL],
  )
  return rows.map(asAdminCandidate)
}

async function deleteEmptyAdminDuplicates(
  client: { query: typeof pool.query },
  keepUserId: string,
  candidates: AdminUserCandidate[],
): Promise<void> {
  for (const candidate of candidates) {
    if (candidate.id === keepUserId) continue
    const empty =
      candidate.balanceMicros === 0 &&
      candidate.keyCount === 0 &&
      candidate.usageCount === 0 &&
      candidate.walletCount === 0 &&
      candidate.paymentCount === 0 &&
      candidate.subscriptionCount === 0 &&
      candidate.inviteCount === 0
    if (!empty) continue
    await client.query('DELETE FROM users WHERE id = $1', [candidate.id])
  }
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

    const candidates = await listAdminUserCandidates(client, configuredId, email)
    let userId = pickAdminUser(candidates, configuredId, email)?.id ?? null

    if (userId) {
      await client.query(
        `UPDATE users
         SET password_hash = $1, status = 'active', accepted_at = COALESCE(accepted_at, $2)
         WHERE id = $3`,
        [storedHash, now, userId],
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
    await deleteEmptyAdminDuplicates(client, userId, candidates)
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
