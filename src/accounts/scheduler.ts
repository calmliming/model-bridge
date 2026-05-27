import { and, eq, ne } from 'drizzle-orm'
import { db } from '../db/index'
import { accounts } from '../db/schema'

/** How long an account stays in cooldown after a failure, by kind. */
const COOLDOWN_MS: Record<'rate_limited' | 'error', number> = {
  rate_limited: 10 * 60_000,
  error: 2 * 60_000,
}

/**
 * Picks an account for a provider using least-recently-used rotation.
 * Skips disabled accounts, accounts in cooldown, and any in `exclude`
 * (already tried this request). Returns null when none are available.
 */
export async function pickAccount(provider: string, exclude: string[] = []) {
  const now = Date.now()
  const rows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.provider, provider), ne(accounts.status, 'disabled')))

  const available = rows.filter(
    (a) => !exclude.includes(a.id) && (!a.cooldownUntil || a.cooldownUntil < now),
  )
  if (available.length === 0) return null

  // Least-recently-used first — spreads load evenly across accounts.
  available.sort((a, b) => (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0))
  return available[0]
}

/** Marks an account as healthy and just used (clears any cooldown). */
export async function markAccountUsed(id: string): Promise<void> {
  await db.update(accounts)
    .set({ lastUsedAt: Date.now(), status: 'active', cooldownUntil: null })
    .where(eq(accounts.id, id))
}

/** Permanently disables an account (e.g. revoked OAuth token that cannot self-heal). */
export async function disableAccount(id: string): Promise<void> {
  await db.update(accounts)
    .set({ status: 'disabled', cooldownUntil: null })
    .where(eq(accounts.id, id))
}

/** Puts an account into cooldown after a 429 (rate_limited) or other failure (error). */
export async function penalizeAccount(
  id: string,
  kind: 'rate_limited' | 'error',
  cooldownUntil?: number | null,
): Promise<void> {
  const fallbackUntil = Date.now() + COOLDOWN_MS[kind]
  const until = cooldownUntil && cooldownUntil > Date.now() ? cooldownUntil : fallbackUntil
  await db.update(accounts)
    .set({ status: kind, cooldownUntil: until })
    .where(eq(accounts.id, id))
}
