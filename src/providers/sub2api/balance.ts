import { normalizeSub2ApiBaseUrl } from './relay'
import { fetchWithConnectTimeout } from '../../http/upstream'
import {
  balanceQueryFailureMessage,
  balanceRequestHeaders,
  finiteNumber,
  firstNumber,
  formatBalanceInfo,
  objectValue,
  parseTimestamp,
  reconcileBalanceAmounts,
  type AccountBalanceInfo,
  type AccountBalanceSnapshot,
} from '../balance'

const BALANCE_TIMEOUT_MS = 15_000

/**
 * The official Sub2API gateway exposes account usage at `/v1/usage`.  A few
 * older relay deployments use one of the aliases below, so keep the fallback
 * list for compatibility while making the official endpoint the fast path.
 */
export const SUB2API_BALANCE_ENDPOINTS = [
  '/v1/usage',
  '/api/usage',
  '/user/balance',
  '/v1/user/balance',
  '/api/balance',
  '/v1/balance',
] as const

export type Sub2ApiBalanceInfo = AccountBalanceInfo
export type Sub2ApiBalanceSnapshot = AccountBalanceSnapshot

function parseSubscriptionBalance(subscription: Record<string, unknown>): {
  remaining?: number
  totalBalance?: number
  used?: number
  resetAt?: number
} {
  const windowDurations = {
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000,
    monthly: 30 * 24 * 60 * 60 * 1000,
  } as const
  const candidates: Array<{
    limit: number
    used: number
    remaining: number
    resetAt?: number
  }> = []
  for (const period of ['daily', 'weekly', 'monthly'] as const) {
    const limit = finiteNumber(subscription[`${period}_limit_usd`])
    const used = finiteNumber(subscription[`${period}_usage_usd`])
    // Sub2API serializes unconfigured subscription windows as null/zero. They
    // are not real limits and must not turn an unlimited plan into $0.
    if (limit !== undefined && limit > 0 && used !== undefined) {
      const windowStart = parseTimestamp(subscription[`${period}_window_start`])
      candidates.push({
        limit,
        used,
        remaining: Math.max(0, limit - used),
        resetAt: windowStart === undefined ? undefined : windowStart + windowDurations[period],
      })
    }
  }
  if (!candidates.length) return {}
  // The effective subscription balance is the tightest configured window.
  const effective = candidates.reduce((best, current) =>
    current.remaining < best.remaining ? current : best,
  )
  return {
    totalBalance: effective.limit,
    used: effective.used,
    remaining: effective.remaining,
    resetAt: effective.resetAt,
  }
}

/**
 * Parses both the official `/v1/usage` shape and common legacy balance shapes.
 * Returns null for an unrecognized successful response so callers can try the
 * next compatibility endpoint. Official modes remain valid even when a key is
 * configured only with request windows and has no monetary quota.
 */
export function parseSub2ApiBalanceResponse(
  payload: unknown,
  endpoint: string,
): Sub2ApiBalanceInfo | null {
  const root = objectValue(payload)
  if (!root) return null
  const nested = objectValue(root.data)
  const data = nested ?? root
  const quota = objectValue(data.quota)
  const subscription = objectValue(data.subscription)
  const subscriptionBalance = subscription ? parseSubscriptionBalance(subscription) : null

  const result: Sub2ApiBalanceInfo = {
    endpoint,
    mode: typeof data.mode === 'string' ? data.mode : undefined,
    currency:
      typeof data.unit === 'string'
        ? data.unit
        : typeof data.currency === 'string'
          ? data.currency
          : typeof quota?.unit === 'string'
            ? quota.unit
            : undefined,
    planName:
      typeof data.planName === 'string'
        ? data.planName
        : typeof data.plan_name === 'string'
          ? data.plan_name
          : typeof data.plan === 'string'
            ? data.plan
            : undefined,
    hasSubscription:
      typeof data.hasSubscription === 'boolean'
        ? data.hasSubscription
        : typeof data.has_subscription === 'boolean'
          ? data.has_subscription
          : subscription != null,
  }

  if (!result.planName && objectValue(data.plan)) {
    const plan = objectValue(data.plan)!
    if (typeof plan.title === 'string') result.planName = plan.title
    else if (typeof plan.name === 'string') result.planName = plan.name
    else if (typeof plan.id === 'string') result.planName = plan.id
  }

  // Official Sub2API `/v1/usage`: remaining is top-level and quota-limited
  // responses also repeat it under `quota`.
  const reportedRemaining = firstNumber(
    data.remaining,
    data.balance,
    quota?.remaining,
    data.remaining_balance,
    data.remainingBalance,
  )
  // Official Sub2API uses -1 for a subscription without any configured
  // daily/weekly/monthly limit. Preserve that meaning instead of showing a
  // negative dollar balance.
  if (
    subscription &&
    reportedRemaining !== undefined &&
    reportedRemaining < 0 &&
    subscriptionBalance?.remaining === undefined
  ) {
    result.unlimited = true
  } else {
    result.remaining = reportedRemaining
  }
  result.totalBalance = firstNumber(
    quota?.limit,
    data.total,
    data.limit,
    data.total_balance,
    data.totalBalance,
    data.hard_limit_usd,
  )
  result.used = firstNumber(
    quota?.used,
    data.used,
    data.used_balance,
    data.usedBalance,
  )

  if (subscriptionBalance) {
    result.remaining ??= subscriptionBalance.remaining
    result.totalBalance ??= subscriptionBalance.totalBalance
    result.used ??= subscriptionBalance.used
    result.resetAt ??= subscriptionBalance.resetAt
  }

  // Preserve compatibility with OpenAI-style billing responses, but do not
  // mistake `system_hard_limit_usd` for usage: it is another limit, not spend.
  result.totalBalance ??= firstNumber(data.soft_limit_usd)
  result.resetAt =
    parseTimestamp(data.resetAt) ??
    parseTimestamp(data.reset_at) ??
    result.resetAt
  result.expiresAt =
    parseTimestamp(data.expiresAt) ??
    parseTimestamp(data.expires_at) ??
    parseTimestamp(subscription?.expires_at)

  reconcileBalanceAmounts(result)

  if (
    result.remaining === undefined &&
    result.totalBalance === undefined &&
    result.used === undefined &&
    result.unlimited !== true &&
    !(
      endpoint === '/v1/usage' &&
      (result.mode === 'unrestricted' || result.mode === 'quota_limited')
    )
  ) {
    return null
  }
  return result
}

/** Queries the upstream account balance without exposing the API key or raw body. */
export async function fetchSub2ApiBalance(
  apiKey: string,
  baseUrl: string | null,
): Promise<Sub2ApiBalanceInfo> {
  const normalizedBase = normalizeSub2ApiBaseUrl(baseUrl)
  let primaryFailure: string | null = null
  for (const path of SUB2API_BALANCE_ENDPOINTS) {
    try {
      const response = await fetchWithConnectTimeout(`${normalizedBase}${path}`, {
        method: 'GET',
        headers: balanceRequestHeaders(apiKey),
        // Never forward either credential header to a redirect target. A
        // canonical Base URL is required for this administrative query.
        redirect: 'error',
      }, BALANCE_TIMEOUT_MS)
      if (!response.ok) {
        if (path === '/v1/usage') primaryFailure = `${path} 返回 HTTP ${response.status}`
        if (response.body) await response.body.cancel().catch(() => undefined)
        continue
      }
      const payload: unknown = await response.json()
      const parsed = parseSub2ApiBalanceResponse(payload, path)
      if (parsed) return parsed
      if (path === '/v1/usage') primaryFailure = `${path} 返回了无法识别的余额响应`
    } catch (error) {
      if (path === '/v1/usage') primaryFailure = balanceQueryFailureMessage(error, path, BALANCE_TIMEOUT_MS)
      // A deployment may not expose every compatibility endpoint. Continue
      // without logging response bodies or credentials.
    }
  }
  throw new Error(`Sub2API 余额查询失败：${primaryFailure ?? '上游没有可用的余额接口'}`)
}

export { formatBalanceInfo }
