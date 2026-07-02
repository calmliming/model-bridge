import {
  ensureFreshToken,
  getAccount,
  refreshAccountToken,
  updateAccountMetadata,
  updateAccountQuota,
} from './manager'
import {
  accountQuotaFromMetadata,
  quotaPauseUntil,
  resolveAutopausePercent,
  type AccountQuotaSnapshot,
} from './quota'
import { clearAccountCooldown, penalizeAccount } from './scheduler'
import { getQuotaAutopausePercent } from '../db/settings'
import {
  fetchOpenAIQuota,
  openAIAccountIdFromMetadata,
  OpenAIQuotaError,
  resetOpenAIQuota,
} from '../providers/openai/quota'

export { OpenAIQuotaError }

export interface OpenAIQuotaResult {
  quota: AccountQuotaSnapshot
  resetCredits: number | null
}

export interface OpenAIResetResult {
  windowsReset: number
  quota: AccountQuotaSnapshot
  resetCredits: number | null
}

type AccountRow = NonNullable<Awaited<ReturnType<typeof getAccount>>>

interface LoadedOpenAIAccount {
  account: AccountRow
  chatgptAccountId: string
}

const MISSING_OPENAI_ACCOUNT_ID_MESSAGE =
  '缺少 ChatGPT 账户标识，无法刷新配额；请重新授权 OpenAI 账号后再试'

function assertOpenAIAccount(account: AccountRow): void {
  if (account.provider !== 'openai') {
    throw new OpenAIQuotaError('该操作仅支持 OpenAI OAuth 账号', 400)
  }
}

async function tryRefreshOpenAIIdentity(id: string): Promise<LoadedOpenAIAccount | null> {
  try {
    // Older OpenAI accounts may predate identity extraction. A forced token
    // refresh can return an id_token and let manager.ts backfill metadata.
    await refreshAccountToken(id)
  } catch {
    return null
  }

  const account = await getAccount(id)
  if (!account) throw new OpenAIQuotaError('account not found', 404)
  assertOpenAIAccount(account)

  const chatgptAccountId = openAIAccountIdFromMetadata(account.metadata)
  return chatgptAccountId ? { account, chatgptAccountId } : null
}

/** Loads an OpenAI OAuth account and its stored ChatGPT account id, or throws. */
async function loadOpenAIAccount(id: string): Promise<LoadedOpenAIAccount> {
  const account = await getAccount(id)
  if (!account) throw new OpenAIQuotaError('account not found', 404)
  assertOpenAIAccount(account)

  const chatgptAccountId = openAIAccountIdFromMetadata(account.metadata)
  if (!chatgptAccountId) return (await tryRefreshOpenAIIdentity(id)) ?? missingOpenAIAccountId()
  return { account, chatgptAccountId }
}

function missingOpenAIAccountId(): never {
  throw new OpenAIQuotaError(MISSING_OPENAI_ACCOUNT_ID_MESSAGE, 409)
}

/** Persists a fresh quota snapshot and standalone reset-credit count. */
async function persistQuota(id: string, snapshot: AccountQuotaSnapshot): Promise<void> {
  await updateAccountQuota(id, snapshot)
  // Stored separately so the relay's header-scrape path doesn't wipe it.
  await updateAccountMetadata(id, { openaiResetCredits: snapshot.resetCredits ?? null })
}

/** Queries ChatGPT quota + reset credits for an OpenAI account and caches the snapshot. */
export async function queryOpenAIAccountQuota(id: string): Promise<OpenAIQuotaResult> {
  const { account, chatgptAccountId } = await loadOpenAIAccount(id)
  const accessToken = await ensureFreshToken(account)
  const quota = await fetchOpenAIQuota(accessToken, chatgptAccountId)
  await persistQuota(id, quota)
  return { quota, resetCredits: quota.resetCredits ?? null }
}

/** Consumes one reset credit, then refreshes the cached quota snapshot. */
export async function resetOpenAIAccountQuota(id: string): Promise<OpenAIResetResult> {
  const { account, chatgptAccountId } = await loadOpenAIAccount(id)
  const accessToken = await ensureFreshToken(account)
  const { windowsReset } = await resetOpenAIQuota(accessToken, chatgptAccountId)
  // Refresh the snapshot so the new reset times and decremented credit balance
  // are reflected locally. A failure here doesn't undo the consumed credit, so
  // fall back to the cached snapshot rather than surfacing an error.
  let quota: AccountQuotaSnapshot
  let refreshed = true
  try {
    quota = await fetchOpenAIQuota(accessToken, chatgptAccountId)
    await persistQuota(id, quota)
  } catch {
    refreshed = false
    quota =
      accountQuotaFromMetadata((await getAccount(id))?.metadata) ??
      { source: 'openai', updatedAt: Date.now(), windows: [], resetCredits: null }
  }

  // A reset credit exists to make the account usable again — but consuming it
  // upstream does not clear the local auto-pause cooldown, so without this the
  // account stays in `rate_limited` (invisible to pickAccount) until its old,
  // now-stale window reset. Re-evaluate against the fresh quota: keep it paused
  // only if a window still breaches the threshold, otherwise clear the cooldown
  // so it rejoins the pool. When the refresh failed we can't recompute, so clear
  // optimistically — the credit did reset the window upstream.
  const threshold = resolveAutopausePercent(account.metadata, await getQuotaAutopausePercent())
  const pauseUntil = refreshed ? quotaPauseUntil(quota, threshold) : null
  if (pauseUntil) {
    await penalizeAccount(id, 'rate_limited', pauseUntil)
  } else {
    await clearAccountCooldown(id)
  }

  return { windowsReset, quota, resetCredits: quota.resetCredits ?? null }
}
