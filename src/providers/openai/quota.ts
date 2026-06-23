import { randomUUID } from 'node:crypto'
import type { AccountQuotaSnapshot, AccountQuotaWindow } from '../../accounts/quota'
import type {
  OpenAIAccountMetadata,
  OpenAIRateLimitWindow,
  OpenAIResetCreditResult,
  OpenAIUsageResponse,
} from './types'

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const RESET_CREDIT_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume'
const USER_AGENT = 'codex_cli_rs/0.20.0'
const REQUEST_TIMEOUT_MS = 20_000

/** Raised when a ChatGPT quota/reset call cannot be completed. */
export class OpenAIQuotaError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message)
    this.name = 'OpenAIQuotaError'
  }
}

/** Reads the stored ChatGPT account id from account metadata. */
export function openAIAccountIdFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const openai = (metadata as { openai?: OpenAIAccountMetadata }).openai
  if (!openai || typeof openai !== 'object') return null
  return openai.chatgptAccountId ?? openai.organizationId ?? null
}

/** Common headers for ChatGPT backend quota/reset calls. */
function quotaHeaders(accessToken: string, chatgptAccountId: string): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    'chatgpt-account-id': chatgptAccountId,
    'user-agent': USER_AGENT,
    originator: 'codex_cli_rs',
    'oai-language': 'en-US',
    accept: 'application/json',
  }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new OpenAIQuotaError(`上游请求超时（${REQUEST_TIMEOUT_MS / 1000}s）`, 504)
    }
    throw new OpenAIQuotaError(`上游请求失败：${(err as Error).message}`, 502)
  } finally {
    clearTimeout(timer)
  }
}

/** Maps a ChatGPT rate-limit window onto the generic quota window shape. */
function mapWindow(
  key: AccountQuotaWindow['key'],
  label: string,
  window: OpenAIRateLimitWindow | null | undefined,
  now: number,
): AccountQuotaWindow | null {
  if (!window || typeof window !== 'object') return null
  const usedPercent =
    typeof window.used_percent === 'number'
      ? Math.max(0, Math.min(100, window.used_percent))
      : null
  let resetAt: number | null = null
  if (typeof window.reset_at === 'number' && window.reset_at > 0) {
    resetAt = window.reset_at > 10_000_000_000 ? Math.trunc(window.reset_at) : window.reset_at * 1000
  } else if (typeof window.reset_after_seconds === 'number' && window.reset_after_seconds >= 0) {
    resetAt = now + window.reset_after_seconds * 1000
  }
  if (usedPercent == null && resetAt == null) return null
  return {
    key,
    label,
    usedPercent,
    resetAt,
    exceeded: usedPercent != null && usedPercent >= 100,
  }
}

/** Decides which window is the 5h (hourly) bucket from its window length. */
function classifyWindows(
  primary: OpenAIRateLimitWindow | null | undefined,
  secondary: OpenAIRateLimitWindow | null | undefined,
): { hourly: OpenAIRateLimitWindow | null | undefined; weekly: OpenAIRateLimitWindow | null | undefined } {
  const primarySeconds = typeof primary?.limit_window_seconds === 'number' ? primary.limit_window_seconds : null
  const secondarySeconds = typeof secondary?.limit_window_seconds === 'number' ? secondary.limit_window_seconds : null
  // ChatGPT returns the short (5h) window first as `primary`; fall back to that
  // ordering when window lengths are missing.
  if (primarySeconds != null && secondarySeconds != null) {
    return primarySeconds <= secondarySeconds
      ? { hourly: primary, weekly: secondary }
      : { hourly: secondary, weekly: primary }
  }
  return { hourly: primary, weekly: secondary }
}

/** Builds an AccountQuotaSnapshot from a parsed `wham/usage` response. */
export function snapshotFromUsage(usage: OpenAIUsageResponse, now = Date.now()): AccountQuotaSnapshot {
  const rateLimit = usage.rate_limit ?? {}
  const { hourly, weekly } = classifyWindows(rateLimit.primary_window, rateLimit.secondary_window)
  const windows = [
    mapWindow('hourly', '5小时', hourly, now),
    mapWindow('weekly', '7天', weekly, now),
  ].filter((w): w is AccountQuotaWindow => w !== null)
  const available = usage.rate_limit_reset_credits?.available_count
  return {
    source: 'openai',
    updatedAt: now,
    windows,
    resetCredits: typeof available === 'number' ? Math.max(0, Math.trunc(available)) : null,
  }
}

/**
 * Queries a ChatGPT account's quota usage and reset-credit balance.
 * Logs only the account id and status — never the token or raw response.
 */
export async function fetchOpenAIQuota(
  accessToken: string,
  chatgptAccountId: string,
): Promise<AccountQuotaSnapshot> {
  const response = await fetchWithTimeout(USAGE_URL, {
    method: 'GET',
    headers: quotaHeaders(accessToken, chatgptAccountId),
  })
  if (!response.ok) {
    const detail = response.status === 401 || response.status === 403 ? '（请重新授权该账号）' : ''
    throw new OpenAIQuotaError(`查询配额失败：上游返回 ${response.status}${detail}`, response.status)
  }
  const data = (await response.json().catch(() => null)) as OpenAIUsageResponse | null
  if (!data) throw new OpenAIQuotaError('查询配额失败：无法解析上游响应', 502)
  return snapshotFromUsage(data)
}

/**
 * Consumes one rate-limit reset credit for a ChatGPT account.
 * `redeem_request_id` is a client-generated idempotency key.
 */
export async function resetOpenAIQuota(
  accessToken: string,
  chatgptAccountId: string,
): Promise<OpenAIResetCreditResult> {
  const response = await fetchWithTimeout(RESET_CREDIT_URL, {
    method: 'POST',
    headers: { ...quotaHeaders(accessToken, chatgptAccountId), 'content-type': 'application/json' },
    body: JSON.stringify({ redeem_request_id: randomUUID() }),
  })
  if (!response.ok) {
    let reason = ''
    if (response.status === 401 || response.status === 403) reason = '（请重新授权该账号）'
    else if (response.status === 429 || response.status === 400) reason = '（可能没有可用的 reset credit）'
    throw new OpenAIQuotaError(`重置限额失败：上游返回 ${response.status}${reason}`, response.status)
  }
  const data = (await response.json().catch(() => null)) as { windows_reset?: number } | null
  return { windowsReset: typeof data?.windows_reset === 'number' ? data.windows_reset : 0 }
}
