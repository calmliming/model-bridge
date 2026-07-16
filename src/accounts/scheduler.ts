import { and, eq, inArray, lte, ne, notExists, sql } from 'drizzle-orm'
import { db } from '../db/index'
import { accountGroupMembers, accounts } from '../db/schema'
import { getStickyAccountId } from './session'
import { accountQuotaFromMetadata, isAccountScopedQuotaWindow } from './quota'
import { getOpenAiSchedulingStrategy } from '../db/settings'

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
 *
 * `groupId` scopes the pool: a key bound to a group only reaches that group's
 * accounts; an unbound key (null) only reaches ungrouped accounts (the default
 * pool). Existing data is all-null, so unbound keys keep seeing every account.
 *
 * `model` additionally skips accounts whose metadata carries an unexpired
 * model-scoped cooldown for that model (see `penalizeAccountModel`).
 */
export async function pickAccount(
  provider: string,
  exclude: string[] = [],
  sessionKey?: string | null,
  groupId?: string | null,
  model?: string | null,
) {
  const now = Date.now()
  await clearExpiredAccountCooldowns(now)

  // A grouped key only reaches that group's members, and the scheduling weight
  // is the per-membership override when set, else the account's base weight.
  // An unbound key (default pool) only reaches accounts with no membership row.
  const rows = groupId
    ? await db
        .select({
          id: accounts.id,
          status: accounts.status,
          cooldownUntil: accounts.cooldownUntil,
          lastUsedAt: accounts.lastUsedAt,
          metadata: accounts.metadata,
          proxyUrl: accounts.proxyUrl,
          oauthAccessToken: accounts.oauthAccessToken,
          tokenExpiresAt: accounts.tokenExpiresAt,
          concurrencyLimit: accounts.concurrencyLimit,
          effectiveWeight: sql<number>`COALESCE(${accountGroupMembers.weight}, ${accounts.weight})`,
        })
        .from(accounts)
        .innerJoin(accountGroupMembers, eq(accountGroupMembers.accountId, accounts.id))
        .where(and(
          eq(accounts.provider, provider),
          ne(accounts.status, 'disabled'),
          eq(accountGroupMembers.groupId, groupId),
        ))
    : await db
        .select({
          id: accounts.id,
          status: accounts.status,
          cooldownUntil: accounts.cooldownUntil,
          lastUsedAt: accounts.lastUsedAt,
          metadata: accounts.metadata,
          proxyUrl: accounts.proxyUrl,
          oauthAccessToken: accounts.oauthAccessToken,
          tokenExpiresAt: accounts.tokenExpiresAt,
          concurrencyLimit: accounts.concurrencyLimit,
          effectiveWeight: sql<number>`${accounts.weight}`,
        })
        .from(accounts)
        .where(and(
          eq(accounts.provider, provider),
          ne(accounts.status, 'disabled'),
          notExists(
            db
              .select({ one: sql`1` })
              .from(accountGroupMembers)
              .where(eq(accountGroupMembers.accountId, accounts.id)),
          ),
        ))

  const available = rows.filter(
    (a) =>
      !exclude.includes(a.id) &&
      (!a.cooldownUntil || a.cooldownUntil < now) &&
      !(model && (modelCooldownUntil(a.metadata, model) ?? 0) > now),
  )
  if (available.length === 0) return null

  if (sessionKey) {
    const stickyId = await getStickyAccountId(sessionKey, now)
    if (stickyId) {
      const stuck = available.find((a) => a.id === stickyId)
      if (stuck) return stuck
    }
  }

  // OpenAI-only "prefer soonest reset" fallback: when enabled, pick the account
  // whose quota window resets soonest so a nearly-spent account drains first and
  // the rest stay in reserve. Sticky sessions above are unaffected; all other
  // providers keep weighted-LRU. Falls back to weight, then LRU, on ties / when
  // an account has no known reset time.
  if (provider === 'openai' && (await getOpenAiSchedulingStrategy()) === 'prefer_soonest_reset') {
    available.sort((a, b) => {
      const resetDiff = soonestReset(a.metadata, now) - soonestReset(b.metadata, now)
      if (resetDiff !== 0) return resetDiff
      const weightDiff = Math.max(1, b.effectiveWeight ?? 1) - Math.max(1, a.effectiveWeight ?? 1)
      if (weightDiff !== 0) return weightDiff
      return (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0)
    })
    return available[0]
  }

  available.sort((a, b) => {
    const weightDiff = Math.max(1, b.effectiveWeight ?? 1) - Math.max(1, a.effectiveWeight ?? 1)
    if (weightDiff !== 0) return weightDiff
    return (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0)
  })
  return available[0]
}

/**
 * Earliest future quota-window reset for an account, in epoch ms. Accounts with
 * no known future reset sort last (Infinity) so reset-bearing accounts drain first.
 * Exported for unit testing the `prefer_soonest_reset` ordering.
 */
export function soonestReset(metadata: unknown, now: number): number {
  const quota = accountQuotaFromMetadata(metadata)
  if (!quota) return Number.POSITIVE_INFINITY
  const future = quota.windows
    .filter(isAccountScopedQuotaWindow)
    .map((w) => w.resetAt)
    .filter((t): t is number => typeof t === 'number' && t > now)
  return future.length ? Math.min(...future) : Number.POSITIVE_INFINITY
}

/**
 * Clears a transient cooldown (`rate_limited` / `error`), returning the account
 * to the pool immediately. Only touches accounts currently in a transient state
 * — a `disabled` account (permanent, e.g. revoked token) is left untouched so a
 * quota reset can never silently revive a dead credential.
 */
export async function clearAccountCooldown(id: string): Promise<void> {
  await db.update(accounts)
    .set({ status: 'active', cooldownUntil: null })
    .where(and(eq(accounts.id, id), inArray(accounts.status, ['rate_limited', 'error'])))
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

/**
 * The unexpired model-scoped cooldown for `model` from an account's metadata
 * (`metadata.modelCooldowns[model]`, epoch ms), or null when none is stored.
 * Exported for unit testing the pickAccount filter.
 */
export function modelCooldownUntil(metadata: unknown, model: string): number | null {
  if (!model || !metadata || typeof metadata !== 'object') return null
  const map = (metadata as { modelCooldowns?: Record<string, unknown> }).modelCooldowns
  if (!map || typeof map !== 'object') return null
  const value = map[model]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Cools down a single model on an account, leaving the account itself active
 * so its other models keep being scheduled. Used for failures attributable to
 * one model only (e.g. a plan-gated OpenAI model's rate limit) — an account-
 * wide `penalizeAccount` there would blank the whole account for every model.
 *
 * Stored in `accounts.metadata.modelCooldowns`; expired entries are pruned on
 * each write and ignored on read, so no background cleanup is needed. The
 * read-modify-write can race a concurrent metadata update (e.g. a quota
 * snapshot) and occasionally lose one entry — acceptable for a short cooldown.
 */
export async function penalizeAccountModel(
  id: string,
  model: string,
  kind: 'rate_limited' | 'error',
  cooldownUntil?: number | null,
): Promise<void> {
  if (!model) return penalizeAccount(id, kind, cooldownUntil)
  const now = Date.now()
  const fallbackUntil = now + COOLDOWN_MS[kind]
  const until = cooldownUntil && cooldownUntil > now ? cooldownUntil : fallbackUntil
  const [row] = await db
    .select({ metadata: accounts.metadata })
    .from(accounts)
    .where(eq(accounts.id, id))
  if (!row) return
  const metadata =
    row.metadata && typeof row.metadata === 'object'
      ? { ...(row.metadata as Record<string, unknown>) }
      : ({} as Record<string, unknown>)
  const existing = metadata.modelCooldowns
  const pruned: Record<string, number> = {}
  if (existing && typeof existing === 'object') {
    for (const [key, value] of Object.entries(existing as Record<string, unknown>)) {
      if (typeof value === 'number' && value > now) pruned[key] = value
    }
  }
  pruned[model] = until
  metadata.modelCooldowns = pruned
  await db.update(accounts).set({ metadata }).where(eq(accounts.id, id))
}
