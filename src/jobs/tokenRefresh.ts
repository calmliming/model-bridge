import { ne } from 'drizzle-orm'
import { db } from '../db/index'
import { accounts } from '../db/schema'
import { refreshAccountToken } from '../accounts/manager'

const CHECK_INTERVAL_MS = 60_000
const REFRESH_AHEAD_MS = 5 * 60_000

/** Refreshes the OAuth token of every account that is close to expiring. */
async function refreshExpiringTokens(): Promise<void> {
  const threshold = Date.now() + REFRESH_AHEAD_MS
  const rows = await db.select().from(accounts).where(ne(accounts.status, 'disabled'))
  for (const account of rows) {
    if (!account.tokenExpiresAt || account.tokenExpiresAt > threshold) continue
    if (!account.oauthRefreshToken) continue
    try {
      await refreshAccountToken(account.id)
      console.log(`[token-refresh] refreshed account "${account.name}"`)
    } catch (err) {
      console.error(`[token-refresh] failed for "${account.name}":`, (err as Error).message)
    }
  }
}

/** Starts the background loop that keeps account tokens fresh. */
export function startTokenRefreshJob(): void {
  setInterval(() => {
    void refreshExpiringTokens()
  }, CHECK_INTERVAL_MS)
}
