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

/** A late success must not erase a concurrent cooldown or revive a disabled account. */
export async function markAccountUsed(id: string): Promise<void> {
  const now = Date.now()
  await db.update(accounts)
    .set({
      lastUsedAt: now,
      status: sql`CASE WHEN ${accounts.status} = 'disabled' OR ${accounts.cooldownUntil} > ${now} THEN ${accounts.status} ELSE 'active' END`,
      cooldownUntil: sql`CASE WHEN ${accounts.cooldownUntil} > ${now} THEN ${accounts.cooldownUntil} ELSE NULL END`,
    })
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
    .set({ status: kind, cooldownUntil: sql`GREATEST(COALESCE(${accounts.cooldownUntil}, 0), ${until})` })
    .where(and(eq(accounts.id, id), sql`${accounts.status} <> 'disabled'`))
}

/**
 * The unexpired model-scoped cooldown for `model` from an account's metadata
 * (`metadata.modelCooldowns[model]`, epoch ms), or null when none is stored.
 * Fable and Codex Spark variants also consult their family key. Exported for
 * unit testing the pickAccount filter.
 */
export function modelCooldownUntil(metadata: unknown, model: string): number | null {
  if (!model || !metadata || typeof metadata !== 'object') return null
  const map = (metadata as { modelCooldowns?: Record<string, unknown> }).modelCooldowns
  if (!map || typeof map !== 'object') return null
  const exact = map[model]
  if (typeof exact === 'number' && Number.isFinite(exact)) return exact
  const canonical = canonicalModelCooldownKey(model)
  if (canonical === model) return null
  const family = map[canonical]
  return typeof family === 'number' && Number.isFinite(family) ? family : null
}

export interface AccountAvailability {
  total: number
  active: number
  cooling: number
  disabled: number
  /** Accounts currently cooling that are also already spent for this request. */
  coolingSticky: number
  /** Earliest future `cooldownUntil` among cooling accounts, or null. */
  earliestCooldownUntil: number | null
}

/**
 * Buckets every configured account of a provider by why it is (un)available.
 *
 * `pickAccount` only answers yes/no, so a caller that finds nothing cannot tell
 * an empty pool from one that is merely cooling down. Callers use this to say
 * which one it is — reporting "no account configured" while the account is
 * present but cooling sends operators to look at settings that are already
 * correct. Must run after `pickAccount` so `clearExpiredAccountCooldowns` has
 * already released expired entries.
 *
 * `model` adds the same model-scoped cooldown filter `pickAccount` applies.
 */
export async function accountAvailability(
  provider: string,
  exclude: string[] = [],
  model?: string | null,
  now = Date.now(),
): Promise<AccountAvailability> {
  const rows = await db
    .select({
      id: accounts.id,
      status: accounts.status,
      cooldownUntil: accounts.cooldownUntil,
      metadata: accounts.metadata,
    })
    .from(accounts)
    .where(eq(accounts.provider, provider))

  const summary: AccountAvailability = {
    total: rows.length,
    active: 0,
    cooling: 0,
    disabled: 0,
    coolingSticky: 0,
    earliestCooldownUntil: null,
  }
  for (const row of rows) {
    if (row.status === 'disabled') {
      summary.disabled += 1
      continue
    }
    const modelUntil = modelCooldownUntil(row.metadata, model ?? '') ?? 0
    const coolingUntil = Math.max(row.cooldownUntil ?? 0, modelUntil) || null
    if (coolingUntil && coolingUntil > now) {
      summary.cooling += 1
      if (exclude.includes(row.id)) summary.coolingSticky += 1
      summary.earliestCooldownUntil = summary.earliestCooldownUntil === null
        ? coolingUntil
        : Math.min(summary.earliestCooldownUntil, coolingUntil)
      continue
    }
    summary.active += 1
  }
  return summary
}

/** "（还有 42 秒）" for a cooldown that is about to expire, plus the count. */
function coolingDetail(summary: AccountAvailability, now: number): string {
  const seconds = summary.earliestCooldownUntil === null
    ? null
    : Math.max(1, Math.round((summary.earliestCooldownUntil - now) / 1000))
  const count = `共 ${summary.cooling} 个`
  return seconds === null ? count : `${count}，最快约 ${seconds} 秒后恢复`
}

/**
 * Customer-facing explanation for an empty `pickAccount` result: names the
 * provider, the reason, and when to retry, so the message never reads as
 * operator misconfiguration when the pool is simply cooling down.
 */
export function unavailableAccountMessage(
  providerLabel: string,
  summary: AccountAvailability,
  triedCount: number,
  now = Date.now(),
): string {
  if (summary.total === 0) return `no ${providerLabel} account configured`
  if (summary.disabled === summary.total) return `all ${providerLabel} accounts are disabled`
  if (summary.cooling > 0 && summary.active === 0) {
    return `${providerLabel}账号正在冷却中（${coolingDetail(summary, now)}），请稍后重试`
  }
  if (triedCount > 0) return `all ${providerLabel} accounts are unavailable`
  return `no available ${providerLabel} account`
}


/** Shares one cooldown across Fable, Codex Spark, and GPT Image model aliases. */
export function canonicalModelCooldownKey(model: string): string {
  const normalized = model.trim().toLowerCase()
  if (normalized === 'openai:image_generation' || normalized.startsWith('gpt-image-')) {
    return 'openai:image_generation'
  }
  if (normalized.startsWith('claude-') && (normalized.includes('fable') || normalized.includes('mythos'))) {
    return 'claude-fable-5'
  }
  if (
    (normalized.startsWith('gpt-') || /^o\d/.test(normalized)) &&
    (normalized.includes('codex-spark') || /(?:^|[-_])spark(?:[-_]|$)/.test(normalized))
  ) {
    return 'gpt-5.3-codex-spark'
  }
  return model
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
  const key = canonicalModelCooldownKey(model)
  // Merge against the row locked by UPDATE, so parallel model failures and
  // quota/token metadata updates cannot overwrite each other.
  await db.update(accounts).set({ metadata: sql`
    jsonb_set(COALESCE(${accounts.metadata}, '{}'::jsonb), '{modelCooldowns}',
      COALESCE((SELECT jsonb_object_agg(entry.key, entry.value)
        FROM jsonb_each(CASE WHEN jsonb_typeof(${accounts.metadata}->'modelCooldowns') = 'object'
          THEN ${accounts.metadata}->'modelCooldowns' ELSE '{}'::jsonb END) AS entry
        WHERE CASE WHEN jsonb_typeof(entry.value) = 'number'
          THEN (entry.value::text)::numeric > ${now} ELSE false END), '{}'::jsonb)
      || jsonb_build_object(${key}::text, GREATEST(${until}::bigint,
        CASE WHEN jsonb_typeof(${accounts.metadata}->'modelCooldowns'->${key}::text) = 'number'
          THEN (${accounts.metadata}->'modelCooldowns'->>${key}::text)::numeric ELSE 0 END)), true)
  ` }).where(eq(accounts.id, id))

}
