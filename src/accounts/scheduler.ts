import { and, eq, inArray, lte, ne } from 'drizzle-orm'
import { db } from '../db/index'
import { accounts } from '../db/schema'
import { getStickyAccountId } from './session'

/** How long an account stays in cooldown after a failure, by kind. */
const COOLDOWN_MS: Record<'rate_limited' | 'error', number> = {
  rate_limited: 10 * 60_000,
  error: 2 * 60_000,
}

/** Clears transient cooldown states once their retry window has elapsed. */
export async function clearExpiredAccountCooldowns(now = Date.now()): Promise<void> {
  await db.update(accounts)
    .set({ status: 'active', cooldownUntil: null })
    .where(and(
      inArray(accounts.status, ['rate_limited', 'error']),
      lte(accounts.cooldownUntil, now),
    ))
}

/**
 * Picks an account for a provider by scheduler priority, then LRU rotation.
 * Skips disabled accounts, accounts in cooldown, and any in `exclude`
 * (already tried this request). Returns null when none are available.
 *
 * When `sessionKey` is given and that session is already bound to an available
 * account, the bound account is reused (sticky session) so a conversation
 * stays on one upstream and keeps its prompt cache warm. If the bound account
 * is unavailable (cooldown / disabled / already tried), it transparently falls
 * back to LRU.
 */
export async function pickAccount(
  provider: string,
  exclude: string[] = [],
  sessionKey?: string | null,
) {
  const now = Date.now()
  await clearExpiredAccountCooldowns(now)
  const rows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.provider, provider), ne(accounts.status, 'disabled')))

  const available = rows.filter(
    (a) => !exclude.includes(a.id) && (!a.cooldownUntil || a.cooldownUntil < now),
  )
  if (available.length === 0) return null

  if (sessionKey) {
    const stickyId = getStickyAccountId(sessionKey, now)
    if (stickyId) {
      const stuck = available.find((a) => a.id === stickyId)
      if (stuck) return stuck
    }
  }

  available.sort((a, b) => {
    const weightDiff = Math.max(1, b.weight ?? 1) - Math.max(1, a.weight ?? 1)
    if (weightDiff !== 0) return weightDiff
    return (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0)
  })
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
