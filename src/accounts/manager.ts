import { randomBytes } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { db } from '../db/index'
import { accounts } from '../db/schema'
import { decrypt, encrypt } from '../crypto'
import { getProvider } from '../providers/registry'
import type { TokenSet } from '../providers/types'

/** Refresh a token this many ms before it actually expires. */
const REFRESH_AHEAD_MS = 5 * 60_000

export interface CreateAccountInput {
  provider: string
  name: string
  tokens: TokenSet
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
      createdAt: accounts.createdAt,
    })
    .from(accounts)
    .orderBy(desc(accounts.createdAt))
    .all()
}

export function getAccount(id: string) {
  return db.select().from(accounts).where(eq(accounts.id, id)).get()
}

export function deleteAccount(id: string): void {
  db.delete(accounts).where(eq(accounts.id, id)).run()
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
