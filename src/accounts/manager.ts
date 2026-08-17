import { randomBytes } from 'node:crypto'
import { desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../db/index'
import { accountGroupMembers, accountGroups, accounts } from '../db/schema'
import { decrypt, encrypt } from '../crypto'
import { getProvider } from '../providers/registry'
import type { TokenSet } from '../providers/types'
import { currentConcurrency } from '../middleware/limits'
import { accountAutopausePercent, accountQuotaFromMetadata, type AccountQuotaSnapshot } from './quota'
import { accountHealth, emptyHealth } from './health'
import { clearExpiredAccountCooldowns, disableAccount } from './scheduler'
import { setAccountGroups as setAccountGroupMembers } from './groups'
import { sub2ApiBalanceFromMetadata } from '../providers/sub2api/balance'
import {
  matchPermanentRefreshSignal,
  PermanentRefreshError,
  reauthStateFromMetadata,
  refreshFailureStatus,
  type AccountReauthState,
} from './refreshErrors'
import { assertSafeUpstreamEgress, assertSafeUpstreamUrl } from '../http/urlGuard'

/** Refresh a token this many ms before it actually expires. */
const REFRESH_AHEAD_MS = 5 * 60_000
const AUTH_TAG_ERROR = 'Unsupported state or unable to authenticate data'

export interface CreateAccountInput {
  provider: string
  name: string
  tokens: TokenSet
  /** Optional upstream base URL for relay-style API-key providers. */
  proxyUrl?: string | null
  /** Provider-specific data needed at relay time (e.g. Gemini's project id). */
  metadata?: Record<string, unknown> | null
  /** Optional groups this account joins; empty = default pool. */
  groupIds?: string[] | null
  /** Max simultaneous in-flight requests for this upstream account; null = unlimited. */
  concurrencyLimit?: number | null
  /** Admin-only operational note. Never sent upstream. */
  notes?: string | null
}

export interface AccountUpdatePatch {
  status?: 'active' | 'disabled'
  weight?: number
  concurrencyLimit?: number | null
  groupIds?: string[]
  notes?: string | null
  autopausePercent?: number | null
  proxyUrl?: string | null
}

export interface AccountBatchResult {
  total: number
  successCount: number
  failureCount: number
  results: Array<{ id: string; success: boolean; error?: string }>
}

function metadataObject(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {}
}

/**
 * Shallow-merges metadata sources into one object (or null when all empty).
 * Nested objects like `openai` are replaced wholesale, not deep-merged — the
 * caller passes complete sub-objects. Later sources win on key conflicts.
 */
function mergeMetadata(
  ...sources: Array<Record<string, unknown> | null | undefined>
): Record<string, unknown> | null {
  const merged: Record<string, unknown> = {}
  for (const source of sources) Object.assign(merged, metadataObject(source))
  return Object.keys(merged).length ? merged : null
}

export const accountConcurrencyKey = (accountId: string): string => `account:${accountId}`

function normalizeConcurrencyLimit(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.max(1, Math.min(1000, Math.trunc(value)))
}

function decryptAccountSecret(value: string): string {
  try {
    return decrypt(value)
  } catch (err) {
    if (err instanceof Error && err.message === AUTH_TAG_ERROR) {
      throw new Error('无法解密账号 token：当前 ENCRYPTION_KEY 与保存该账号时使用的密钥不一致')
    }
    throw err
  }
}

/** Stores a new upstream account with its OAuth tokens encrypted at rest. */
export async function createAccount(input: CreateAccountInput): Promise<{ id: string }> {
  const id = randomBytes(12).toString('hex')
  const proxyUrl = input.proxyUrl?.trim()
    ? assertSafeUpstreamUrl(input.proxyUrl).toString().replace(/\/+$/, '')
    : null
  // Merge provider metadata fetched separately (e.g. Gemini project) with any
  // non-secret identity the token exchange derived (e.g. OpenAI id_token claims).
  const metadata = mergeMetadata(input.metadata, input.tokens.metadata)
  await db.insert(accounts)
    .values({
      id,
      provider: input.provider,
      name: input.name,
      oauthAccessToken: encrypt(input.tokens.accessToken),
      oauthRefreshToken: encrypt(input.tokens.refreshToken),
      tokenExpiresAt: input.tokens.expiresAt,
      status: 'active',
      proxyUrl,
      concurrencyLimit: normalizeConcurrencyLimit(input.concurrencyLimit),
      notes: input.notes?.trim() || null,
      metadata,
    })
  if (input.groupIds?.length) {
    await setAccountGroupMembers(id, input.groupIds)
  }
  return { id }
}

/** Lists accounts for the dashboard — OAuth tokens are never exposed. */
export async function listAccounts() {
  await clearExpiredAccountCooldowns()
  const rows = await db
    .select({
      id: accounts.id,
      provider: accounts.provider,
      name: accounts.name,
      status: accounts.status,
      tokenExpiresAt: accounts.tokenExpiresAt,
      cooldownUntil: accounts.cooldownUntil,
      proxyUrl: accounts.proxyUrl,
      weight: accounts.weight,
      concurrencyLimit: accounts.concurrencyLimit,
      lastUsedAt: accounts.lastUsedAt,
      notes: accounts.notes,
      metadata: accounts.metadata,
      createdAt: accounts.createdAt,
    })
    .from(accounts)
    .orderBy(desc(accounts.createdAt))

  // Each account's group memberships, with the effective in-group weight.
  const memberRows = await db
    .select({
      accountId: accountGroupMembers.accountId,
      groupId: accountGroupMembers.groupId,
      groupName: accountGroups.name,
      weight: accountGroupMembers.weight,
    })
    .from(accountGroupMembers)
    .innerJoin(accountGroups, eq(accountGroups.id, accountGroupMembers.groupId))

  const groupsByAccount = new Map<string, Array<{ id: string; name: string; weight: number | null }>>()
  for (const m of memberRows) {
    const list = groupsByAccount.get(m.accountId) ?? []
    list.push({ id: m.groupId, name: m.groupName, weight: m.weight })
    groupsByAccount.set(m.accountId, list)
  }

  // Recent-window health scores for all accounts in one query (no N+1).
  const health = await accountHealth(rows.map((r) => r.id))

  return Promise.all(rows.map(async ({ metadata, ...account }) => ({
    ...account,
    currentConcurrency: await currentConcurrency(accountConcurrencyKey(account.id)),
    groups: groupsByAccount.get(account.id) ?? [],
    quota: accountQuotaFromMetadata(metadata),
    sub2apiBalance: sub2ApiBalanceFromMetadata(metadata),
    autopausePercent: accountAutopausePercent(metadata),
    reauth: reauthStateFromMetadata(metadata),
    health: health.get(account.id) ?? emptyHealth(),
  })))
}

/**
 * Audits legacy custom URLs at startup. Invalid rows are not rewritten; the
 * account id is logged so operators can explicitly allow or repair it.
 */
export async function warnUnsafeStoredUpstreamUrls(): Promise<void> {
  const rows = await db
    .select({ id: accounts.id, proxyUrl: accounts.proxyUrl })
    .from(accounts)
    .where(sql`${accounts.proxyUrl} IS NOT NULL`)
  await Promise.all(rows.map(async ({ id, proxyUrl }) => {
    if (!proxyUrl) return
    try {
      await assertSafeUpstreamEgress(proxyUrl)
    } catch (error) {
      console.warn(
        `[url-guard] account ${id} has a blocked proxy_url: ${error instanceof Error ? error.message : 'unsafe URL'}`,
      )
    }
  }))
}

/** Replaces the set of groups an account belongs to (null/empty = default pool). */
export async function setAccountGroups(id: string, groupIds: string[]): Promise<void> {
  await setAccountGroupMembers(id, groupIds)
}

export async function getAccount(id: string) {
  const [row] = await db.select().from(accounts).where(eq(accounts.id, id))
  return row
}

export async function deleteAccount(id: string): Promise<void> {
  await db.delete(accountGroupMembers).where(eq(accountGroupMembers.accountId, id))
  await db.delete(accounts).where(eq(accounts.id, id))
}

async function applyAccountPatch(id: string, patch: AccountUpdatePatch): Promise<void> {
  const account = await getAccount(id)
  if (!account) throw new Error('account not found')
  if (patch.status) await setAccountStatus(id, patch.status)
  if (patch.weight !== undefined) await setAccountWeight(id, patch.weight)
  if (patch.concurrencyLimit !== undefined) await setAccountConcurrencyLimit(id, patch.concurrencyLimit)
  if (patch.groupIds !== undefined) await setAccountGroups(id, patch.groupIds)
  if (patch.notes !== undefined) await setAccountNotes(id, patch.notes)
  if (patch.autopausePercent !== undefined) await setAccountAutopause(id, patch.autopausePercent)
  if (patch.proxyUrl !== undefined) await setAccountProxyUrl(id, patch.proxyUrl)
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
}

/** Applies the same account patch to many accounts and reports per-row status. */
export async function updateAccounts(ids: string[], patch: AccountUpdatePatch): Promise<AccountBatchResult> {
  const targetIds = uniqueIds(ids)
  const results: AccountBatchResult['results'] = []
  for (const id of targetIds) {
    try {
      await applyAccountPatch(id, patch)
      results.push({ id, success: true })
    } catch (err) {
      results.push({ id, success: false, error: err instanceof Error ? err.message : String(err) })
    }
  }
  const successCount = results.filter((r) => r.success).length
  return {
    total: results.length,
    successCount,
    failureCount: results.length - successCount,
    results,
  }
}

/** Deletes many accounts, including their group memberships. */
export async function deleteAccounts(ids: string[]): Promise<AccountBatchResult> {
  const targetIds = uniqueIds(ids)
  if (!targetIds.length) {
    return { total: 0, successCount: 0, failureCount: 0, results: [] }
  }

  const existingRows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(inArray(accounts.id, targetIds))
  const existingSet = new Set(existingRows.map((row) => row.id))
  const existingIds = targetIds.filter((id) => existingSet.has(id))

  if (existingIds.length) {
    await db.delete(accountGroupMembers).where(inArray(accountGroupMembers.accountId, existingIds))
    await db.delete(accounts).where(inArray(accounts.id, existingIds))
  }

  const results: AccountBatchResult['results'] = targetIds.map((id) =>
    existingSet.has(id)
      ? { id, success: true }
      : { id, success: false, error: 'account not found' },
  )
  const successCount = results.filter((r) => r.success).length
  return {
    total: results.length,
    successCount,
    failureCount: results.length - successCount,
    results,
  }
}

/** Updates provider-specific metadata cached on an account. */
export async function updateAccountMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
  const patch = JSON.stringify(metadata)
  await db.update(accounts)
    // PostgreSQL performs the same shallow merge as object spread, atomically.
    // This prevents concurrent quota, identity, and balance refreshes from
    // overwriting one another after reading an older metadata snapshot.
    .set({ metadata: sql`COALESCE(${accounts.metadata}, '{}'::jsonb) || ${patch}::jsonb` })
    .where(eq(accounts.id, id))
}

/** Stores the latest non-secret quota snapshot observed from upstream headers. */
export async function updateAccountQuota(id: string, quota: AccountQuotaSnapshot): Promise<void> {
  await updateAccountMetadata(id, { quota })
}

/** Enables or disables an account. */
export async function setAccountStatus(id: string, status: 'active' | 'disabled'): Promise<void> {
  await db.update(accounts)
    .set({ status, cooldownUntil: status === 'active' ? null : undefined })
    .where(eq(accounts.id, id))
}

/**
 * Sets a per-account auto-pause threshold override.
 *  - `null` clears the override so the account inherits the global default;
 *  - `0` disables early auto-pause for this account;
 *  - `1`–`100` sets this account's own threshold.
 */
export async function setAccountAutopause(id: string, percent: number | null): Promise<void> {
  const [row] = await db.select({ metadata: accounts.metadata }).from(accounts).where(eq(accounts.id, id))
  const metadata = metadataObject(row?.metadata)
  if (percent == null) {
    delete metadata.autopausePercent
  } else {
    metadata.autopausePercent = Math.max(0, Math.min(100, Math.trunc(percent)))
  }
  await db.update(accounts).set({ metadata }).where(eq(accounts.id, id))
}

/** Sets a per-account in-flight request cap. Null clears the cap. */
export async function setAccountConcurrencyLimit(id: string, limit: number | null): Promise<void> {
  await db.update(accounts)
    .set({ concurrencyLimit: normalizeConcurrencyLimit(limit) })
    .where(eq(accounts.id, id))
}

/** Updates an admin-only operational note for the account. */
export async function setAccountNotes(id: string, notes: string | null): Promise<void> {
  await db.update(accounts)
    .set({ notes: notes?.trim() || null })
    .where(eq(accounts.id, id))
}

/** Updates the optional custom upstream base URL after applying the same guard as account creation. */
export async function setAccountProxyUrl(id: string, proxyUrl: string | null): Promise<void> {
  const normalized = proxyUrl?.trim()
    ? assertSafeUpstreamUrl(proxyUrl).toString().replace(/\/+$/, '')
    : null
  await db.update(accounts).set({ proxyUrl: normalized }).where(eq(accounts.id, id))
}

/** Updates the scheduler priority. Higher weight accounts are tried first. */
export async function setAccountWeight(id: string, weight: number): Promise<void> {
  const normalized = Math.max(1, Math.min(100, Math.trunc(weight)))
  await db.update(accounts)
    .set({ weight: normalized })
    .where(eq(accounts.id, id))
}

async function persistTokens(id: string, tokens: TokenSet): Promise<void> {
  await db.update(accounts)
    .set({
      oauthAccessToken: encrypt(tokens.accessToken),
      oauthRefreshToken: encrypt(tokens.refreshToken),
      tokenExpiresAt: tokens.expiresAt,
    })
    .where(eq(accounts.id, id))
  // A refresh can re-issue an id_token with fresh identity claims; merge any
  // non-secret metadata so backfill works for accounts authorized before the
  // id_token was parsed. Skips the read/write when the refresh carried none.
  if (tokens.metadata && Object.keys(tokens.metadata).length) {
    await updateAccountMetadata(id, tokens.metadata)
  }
  // If this account was previously flagged as needing re-authorization, a
  // successful refresh means the token recovered: clear the flag and bring it
  // back into the pool. Guarded so a routine refresh of a healthy (or merely
  // rate-limited) account never touches its status.
  const [row] = await db
    .select({ metadata: accounts.metadata })
    .from(accounts)
    .where(eq(accounts.id, id))
  if (reauthStateFromMetadata(row?.metadata)) {
    const metadata = metadataObject(row?.metadata)
    delete metadata.reauth
    await db.update(accounts)
      .set({ status: 'active', cooldownUntil: null, metadata })
      .where(eq(accounts.id, id))
  }
}

/**
 * Disables an account and records that it needs manual re-authorization.
 * Reuses `disableAccount` (status=disabled, cooldown cleared) so the scheduler
 * and background refresh loop both skip it, then stamps a metadata marker the
 * dashboard surfaces. A later successful refresh clears the marker (see
 * `persistTokens`).
 */
async function markAccountReauthRequired(id: string, provider: string, signal: string): Promise<void> {
  await disableAccount(id)
  await updateAccountMetadata(id, {
    reauth: { required: true, reason: signal, provider, at: Date.now() } satisfies AccountReauthState,
  })
}

/** Refreshes an account's OAuth token and persists it. Returns the new access token. */
export async function refreshAccountToken(id: string): Promise<string> {
  const account = await getAccount(id)
  if (!account?.oauthRefreshToken) throw new Error('account has no refresh token')
  const provider = getProvider(account.provider)
  if (!provider) throw new Error(`unknown provider: ${account.provider}`)
  try {
    const tokens = await provider.refreshToken(decryptAccountSecret(account.oauthRefreshToken))
    await persistTokens(id, tokens)
    return tokens.accessToken
  } catch (err) {
    // Permanent failure (revoked grant / reused refresh token / deleted team
    // workspace): disable the account and stop retrying. Anything else is
    // transient (429/5xx/network) and bubbles up unchanged so callers keep
    // their existing retry / penalize behavior.
    const signal = matchPermanentRefreshSignal(err)
    if (signal) {
      await markAccountReauthRequired(id, account.provider, signal)
      throw new PermanentRefreshError(id, signal, refreshFailureStatus(err))
    }
    throw err
  }
}

/** Returns a valid access token for an account, refreshing if near expiry. */
export async function ensureFreshToken(account: {
  id: string
  oauthAccessToken: string | null
  tokenExpiresAt: number | null
}): Promise<string> {
  if (account.tokenExpiresAt && account.tokenExpiresAt < Date.now() + REFRESH_AHEAD_MS) {
    return refreshAccountToken(account.id)
  }
  if (!account.oauthAccessToken) throw new Error('account has no access token')
  return decryptAccountSecret(account.oauthAccessToken)
}
