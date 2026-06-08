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

const QUOTA_AUTOPAUSE_PERCENT_KEY = 'quota_autopause_percent'
/** 100 = pause only when a window is actually exceeded (legacy behavior). */
export const DEFAULT_QUOTA_AUTOPAUSE_PERCENT = 100

function clampPercent(value: number, min: number): number {
  return Math.max(min, Math.min(100, Math.trunc(value)))
}

/**
 * Global usage% at which an account auto-pauses (cooldown) until the breaching
 * quota window resets. 100 keeps the legacy "pause only when exceeded" behavior;
 * a lower value pauses earlier so traffic shifts off a nearly-spent account.
 */
export async function getQuotaAutopausePercent(): Promise<number> {
  const raw = await getSetting(QUOTA_AUTOPAUSE_PERCENT_KEY)
  const n = raw == null ? NaN : Number(raw)
  return Number.isFinite(n) ? clampPercent(n, 1) : DEFAULT_QUOTA_AUTOPAUSE_PERCENT
}

/** Sets the global auto-pause threshold (clamped to 1–100). */
export async function setQuotaAutopausePercent(percent: number): Promise<void> {
  await setSetting(QUOTA_AUTOPAUSE_PERCENT_KEY, String(clampPercent(percent, 1)))
}
