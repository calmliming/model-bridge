import { eq } from 'drizzle-orm'
import { db } from './index'
import { settings } from './schema'

/** Reads a value from the key/value settings table. */
export async function getSetting(key: string): Promise<string | undefined> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key))
  return row?.value
}

/** Inserts or updates a value in the settings table. */
export async function setSetting(key: string, value: string): Promise<void> {
  await db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
}

const REGISTRATION_ENABLED_KEY = 'registration_enabled'

/** Whether self-service registration is open. Defaults to false (closed). */
export async function isRegistrationEnabled(): Promise<boolean> {
  return (await getSetting(REGISTRATION_ENABLED_KEY)) === 'true'
}

/** Opens or closes self-service registration. */
export async function setRegistrationEnabled(enabled: boolean): Promise<void> {
  await setSetting(REGISTRATION_ENABLED_KEY, enabled ? 'true' : 'false')
}
