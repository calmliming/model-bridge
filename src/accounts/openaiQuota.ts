import { ensureFreshToken, getAccount, updateAccountMetadata, updateAccountQuota } from './manager'
import { accountQuotaFromMetadata, type AccountQuotaSnapshot } from './quota'
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

/** Loads an OpenAI OAuth account and its stored ChatGPT account id, or throws. */
async function loadOpenAIAccount(id: string): Promise<{
  account: NonNullable<Awaited<ReturnType<typeof getAccount>>>
  chatgptAccountId: string
}> {
  const account = await getAccount(id)
  if (!account) throw new OpenAIQuotaError('account not found', 404)
  if (account.provider !== 'openai') {
    throw new OpenAIQuotaError('该操作仅支持 OpenAI OAuth 账号', 400)
  }
  const chatgptAccountId = openAIAccountIdFromMetadata(account.metadata)
  if (!chatgptAccountId) {
    throw new OpenAIQuotaError(
      '账号缺少 ChatGPT account id，请重新授权该 OpenAI 账号后再试',
      409,
    )
  }
  return { account, chatgptAccountId }
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
  try {
    quota = await fetchOpenAIQuota(accessToken, chatgptAccountId)
    await persistQuota(id, quota)
  } catch {
    quota =
      accountQuotaFromMetadata((await getAccount(id))?.metadata) ??
      { source: 'openai', updatedAt: Date.now(), windows: [], resetCredits: null }
  }
  return { windowsReset, quota, resetCredits: quota.resetCredits ?? null }
}
