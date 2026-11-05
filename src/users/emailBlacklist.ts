import { z } from 'zod'
import { getSetting, setSetting } from '../db/settings'
import { pool } from '../db'
import { UserManagerError } from './manager'

const key = 'registration_email_blacklist'
export const blacklistSchema = z.array(z.string().trim().email().max(254).transform(email => email.toLowerCase())).max(20_000)
let cached: string[] = []
let loadedAt = 0
let revision = 0
let pending: Promise<string[]> | undefined
export function mailboxIdentity(email: string): string {
  const [local = '', rawDomain = ''] = email.trim().toLowerCase().split('@')
  const domain = rawDomain.replace(/\.$/, '')
  if (domain === 'gmail.com' || domain === 'googlemail.com') return `${local.split('+')[0]!.replace(/\./g, '')}@gmail.com`
  return `${local}@${domain}`
}
export async function registrationBlacklist(): Promise<string[]> {
  if (Date.now() - loadedAt < 60_000) return [...cached]
  if (pending) return pending
  const observed = revision
  pending = (async () => {
    try {
      const raw = await getSetting(key)
      const next = blacklistSchema.parse(raw ? JSON.parse(raw) : [])
      if (observed === revision) { cached = [...new Set(next)]; loadedAt = Date.now() }
    } catch { loadedAt = Date.now() - 55_000 }
    return [...cached]
  })().finally(() => { pending = undefined })
  return pending
}
export async function saveRegistrationBlacklist(emails: unknown): Promise<string[]> {
  const next = [...new Set(blacklistSchema.parse(emails))]
  await setSetting(key, JSON.stringify(next))
  revision++
  cached = next
  loadedAt = Date.now()
  return [...next]
}
export async function assertRegistrationEmailAllowed(email: string): Promise<void> {
  const identity = mailboxIdentity(email)
  if ((await registrationBlacklist()).some(blocked => mailboxIdentity(blocked) === identity)) {
    throw new UserManagerError('该邮箱不允许注册，请联系管理员', 400)
  }
}

const normalizedSql = `CASE WHEN lower(split_part(email,'@',2)) IN ('gmail.com','googlemail.com')
  THEN replace(split_part(split_part(lower(email),'@',1),'+',1),'.','') || '@gmail.com'
  ELSE lower(email) END`
export async function blacklistMatches(): Promise<Array<{ id: string; email: string; name: string }>> {
  const identities = (await registrationBlacklist()).map(mailboxIdentity)
  if (!identities.length) return []
  const { rows } = await pool.query(`SELECT id,email,name FROM users WHERE status='active'
    AND id <> COALESCE((SELECT value FROM settings WHERE key='admin.user_id'),'')
    AND (${normalizedSql}) = ANY($1::text[]) ORDER BY created_at LIMIT 1000`, [identities])
  return rows
}
export async function disableBlacklistedUsers(ids: string[]): Promise<number> {
  const allowed = new Set((await blacklistMatches()).map(user => user.id))
  const targets = [...new Set(ids)].filter(id => allowed.has(id))
  if (!targets.length) return 0
  const connection = await pool.connect()
  try {
    await connection.query('BEGIN')
    await connection.query('SELECT id FROM users WHERE id=ANY($1::text[]) FOR UPDATE', [targets])
    const { rows } = await connection.query(`UPDATE users SET status='disabled' WHERE id=ANY($1::text[]) AND status='active'
      AND id <> COALESCE((SELECT value FROM settings WHERE key='admin.user_id'),'') RETURNING id`, [targets])
    await connection.query('UPDATE mcp_grants SET revoked_at=$2 WHERE user_id=ANY($1::text[]) AND revoked_at IS NULL', [rows.map(row => row.id), Date.now()])
    await connection.query('COMMIT')
    return rows.length
  } catch (error) { await connection.query('ROLLBACK').catch(() => {}); throw error }
  finally { connection.release() }
}
