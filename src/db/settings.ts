import { eq } from 'drizzle-orm'
import { db } from './index'
import { settings } from './schema'

/** Reads a value from the key/value settings table. */
export function getSetting(key: string): string | undefined {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value
}

/** Inserts or updates a value in the settings table. */
export function setSetting(key: string, value: string): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run()
}
