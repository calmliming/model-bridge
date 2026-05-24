import { randomBytes } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { db } from '../db/index'
import { accounts } from '../db/schema'
import { decrypt, encrypt } from '../crypto'
import { getProvider } from '../providers/registry'
import type { TokenSet } from '../providers/types'
import { accountQuotaFromMetadata, type AccountQuotaSnapshot } from './quota'

/** Refresh a token this many ms before it actually expires. */
const REFRESH_AHEAD_MS = 5 * 60_000

export interface CreateAccountInput {
  provider: string
  name: string
  tokens: TokenSet
  /** Provider-specific data needed at relay time (e.g. Gemini's project id). */
  metadata?: Record<string, unknown> | null
}

function metadataObject(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {}
}

/** Stores a new upstream account with its OAuth tokens encrypted at rest. */
export function createAccount(input: CreateAccountInput): { id: string } {
  const id = randomBytes(12).toString('hex')
  db.insert(accounts)
    .values({
      id,
      provider: input.provider,
      name: input.name,
      oauthAccessToken: encrypt(input.tokens.accessToken),
      oauthRefreshToken: encrypt(input.tokens.refreshToken),
      tokenExpiresAt: input.tokens.expiresAt,
      status: 'active',
      metadata: input.metadata ?? null,
    })
    .run()
  return { id }
}

/** Lists accounts for the dashboard — OAuth tokens are never exposed. */
export function listAccounts() {
  return db
    .select({
      id: accounts.id,
      provider: accounts.provider,
      name: accounts.name,
      status: accounts.status,
      tokenExpiresAt: accounts.tokenExpiresAt,
      cooldownUntil: accounts.cooldownUntil,
      lastUsedAt: accounts.lastUsedAt,
      metadata: accounts.metadata,
      createdAt: accounts.createdAt,
    })
    .from(accounts)
    .orderBy(desc(accounts.createdAt))
    .all()
    .map(({ metadata, ...account }) => ({
      ...account,
      quota: accountQuotaFromMetadata(metadata),
    }))
}

export function getAccount(id: string) {
  return db.select().from(accounts).where(eq(accounts.id, id)).get()
}

export function deleteAccount(id: string): void {
  db.delete(accounts).where(eq(accounts.id, id)).run()
}

/** Updates provider-specific metadata cached on an account. */
export function updateAccountMetadata(id: string, metadata: Record<string, unknown>): void {
  const row = db.select({ metadata: accounts.metadata }).from(accounts).where(eq(accounts.id, id)).get()
  db.update(accounts)
    .set({ metadata: { ...metadataObject(row?.metadata), ...metadata } })
    .where(eq(accounts.id, id))
    .run()
}

/** Stores the latest non-secret quota snapshot observed from upstream headers. */
export function updateAccountQuota(id: string, quota: AccountQuotaSnapshot): void {
  updateAccountMetadata(id, { quota })
}

/** Enables or disables an account. */
export function setAccountStatus(id: string, status: 'active' | 'disabled'): void {
  db.update(accounts)
    .set({ status, cooldownUntil: status === 'active' ? null : undefined })
    .where(eq(accounts.id, id))
    .run()
}

function persistTokens(id: string, tokens: TokenSet): void {
  db.update(accounts)
    .set({
      oauthAccessToken: encrypt(tokens.accessToken),
      oauthRefreshToken: encrypt(tokens.refreshToken),
      tokenExpiresAt: tokens.expiresAt,
    })
    .where(eq(accounts.id, id))
    .run()
}

/** Refreshes an account's OAuth token and persists it. Returns the new access token. */
export async function refreshAccountToken(id: string): Promise<string> {
  const account = getAccount(id)
  if (!account?.oauthRefreshToken) throw new Error('account has no refresh token')
  const provider = getProvider(account.provider)
  if (!provider) throw new Error(`unknown provider: ${account.provider}`)
  const tokens = await provider.refreshToken(decrypt(account.oauthRefreshToken))
  persistTokens(id, tokens)
  return tokens.accessToken
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
  return decrypt(account.oauthAccessToken)
}
