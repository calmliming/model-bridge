import bcrypt from 'bcryptjs'
import { config } from '../config'
import { getSetting, setSetting } from '../db/settings'

const USERNAME_KEY = 'admin.username'
const PASSWORD_HASH_KEY = 'admin.password_hash'
const BCRYPT_ROUNDS = 10

/** Creates the admin account from env config on first run. */
export async function ensureAdmin(): Promise<void> {
  if (await getSetting(PASSWORD_HASH_KEY)) return
  await setSetting(USERNAME_KEY, config.ADMIN_USERNAME)
  await setSetting(PASSWORD_HASH_KEY, bcrypt.hashSync(config.ADMIN_PASSWORD, BCRYPT_ROUNDS))
  console.log(`[auth] created admin account "${config.ADMIN_USERNAME}"`)
  if (config.ADMIN_PASSWORD === 'admin') {
    console.warn('[auth] WARNING: admin password is the default "admin" — change it in Settings')
  }
}

export async function getAdminUsername(): Promise<string> {
  return (await getSetting(USERNAME_KEY)) ?? config.ADMIN_USERNAME
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
  await setSetting(PASSWORD_HASH_KEY, bcrypt.hashSync(newPassword, BCRYPT_ROUNDS))
  return true
}
