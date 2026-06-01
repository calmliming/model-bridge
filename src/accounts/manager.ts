import { randomBytes } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { db } from '../db/index'
import { accounts } from '../db/schema'
import { decrypt, encrypt } from '../crypto'
import { getProvider } from '../providers/registry'
import type { TokenSet } from '../providers/types'
import { accountQuotaFromMetadata, type AccountQuotaSnapshot } from './quota'
import { clearExpiredAccountCooldowns } from './scheduler'

/** Refresh a token this many ms before it actually expires. */
const REFRESH_AHEAD_MS = 5 * 60_000
const AUTH_TAG_ERROR = 'Unsupported state or unable to authenticate data'

export interface CreateAccountInput {
  provider: string
  name: string
  tokens: TokenSet
  /** Provider-specific data needed at relay time (e.g. Gemini's project id). */
  metadata?: Record<string, unknown> | null
}

export interface AccountHealthSnapshot {
  status: 'healthy' | 'limited' | 'unhealthy'
  checkedAt: number
  latencyMs: number
  message: string
}

function metadataObject(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {}
}

function accountHealthFromMetadata(metadata: unknown): AccountHealthSnapshot | null {
  const health = metadataObject(metadata).health
  if (!health || typeof health !== 'object' || Array.isArray(health)) return null
  const h = health as Record<string, unknown>
  const status = h.status
  if (status !== 'healthy' && status !== 'limited' && status !== 'unhealthy') return null
  return {
    status,
    checkedAt: typeof h.checkedAt === 'number' ? h.checkedAt : 0,
    latencyMs: typeof h.latencyMs === 'number' ? h.latencyMs : 0,
    message: typeof h.message === 'string' ? h.message : '',
  }
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
  await db.insert(accounts)
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
      weight: accounts.weight,
      lastUsedAt: accounts.lastUsedAt,
      metadata: accounts.metadata,
      createdAt: accounts.createdAt,
    })
    .from(accounts)
    .orderBy(desc(accounts.createdAt))
  return rows.map(({ metadata, ...account }) => ({
    ...account,
    quota: accountQuotaFromMetadata(metadata),
    health: accountHealthFromMetadata(metadata),
  }))
}

export async function getAccount(id: string) {
  const [row] = await db.select().from(accounts).where(eq(accounts.id, id))
  return row
}

export async function deleteAccount(id: string): Promise<void> {
  await db.delete(accounts).where(eq(accounts.id, id))
}

/** Updates provider-specific metadata cached on an account. */
export async function updateAccountMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
  const [row] = await db.select({ metadata: accounts.metadata }).from(accounts).where(eq(accounts.id, id))
  await db.update(accounts)
    .set({ metadata: { ...metadataObject(row?.metadata), ...metadata } })
    .where(eq(accounts.id, id))
}

/** Stores the latest non-secret quota snapshot observed from upstream headers. */
export async function updateAccountQuota(id: string, quota: AccountQuotaSnapshot): Promise<void> {
  await updateAccountMetadata(id, { quota })
}

export async function updateAccountHealth(id: string, health: AccountHealthSnapshot): Promise<void> {
  await updateAccountMetadata(id, { health })
}

/** Enables or disables an account. */
export async function setAccountStatus(id: string, status: 'active' | 'disabled'): Promise<void> {
  await db.update(accounts)
    .set({ status, cooldownUntil: status === 'active' ? null : undefined })
    .where(eq(accounts.id, id))
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
}

/** Refreshes an account's OAuth token and persists it. Returns the new access token. */
export async function refreshAccountToken(id: string): Promise<string> {
  const account = await getAccount(id)
  if (!account?.oauthRefreshToken) throw new Error('account has no refresh token')
  const provider = getProvider(account.provider)
  if (!provider) throw new Error(`unknown provider: ${account.provider}`)
  const tokens = await provider.refreshToken(decryptAccountSecret(account.oauthRefreshToken))
  await persistTokens(id, tokens)
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
  return decryptAccountSecret(account.oauthAccessToken)
}
