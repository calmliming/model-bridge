import { normalizeSub2ApiBaseUrl } from './relay'
import { fetchWithConnectTimeout } from '../../http/upstream'

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

export interface Sub2ApiBalanceInfo {
  /** Total credit/limit in the upstream billing currency. */
  totalBalance?: number
  /** Amount already used, when the upstream reports it. */
  used?: number
  /** Remaining credit/limit. */
  remaining?: number
  /** Optional quota reset timestamp (epoch milliseconds). */
  resetAt?: number
  /** Optional key/subscription expiration timestamp (epoch milliseconds). */
  expiresAt?: number
  /** True when the upstream subscription explicitly reports no monetary limit. */
  unlimited?: boolean
  /** Whether the upstream reports an active subscription. */
  hasSubscription?: boolean
  /** Human-readable upstream plan name. */
  planName?: string
  /** Currency returned by the upstream (normally USD). */
  currency?: string
  /** Upstream response mode, for example `quota_limited`. */
  mode?: string
  /** Endpoint that returned the snapshot (never contains credentials). */
  endpoint?: string
}

export interface Sub2ApiBalanceSnapshot extends Sub2ApiBalanceInfo {
  updatedAt: number
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = finiteNumber(value)
    if (parsed !== undefined) return parsed
  }
  return undefined
}

function parseTimestamp(value: unknown): number | undefined {
  const numeric = finiteNumber(value)
  if (numeric !== undefined && numeric > 0) {
    return numeric < 10_000_000_000 ? Math.trunc(numeric * 1000) : Math.trunc(numeric)
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

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

  if (result.totalBalance !== undefined && result.remaining !== undefined && result.used === undefined) {
    result.used = result.totalBalance - result.remaining
  }
  if (result.totalBalance !== undefined && result.used !== undefined && result.remaining === undefined) {
    result.remaining = result.totalBalance - result.used
  }
  if (result.used !== undefined && result.remaining !== undefined && result.totalBalance === undefined) {
    result.totalBalance = result.used + result.remaining
  }

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

function balanceHeaders(apiKey: string): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    'x-api-key': apiKey,
    accept: 'application/json',
  }
}

/** Queries the upstream account balance without exposing the API key or raw body. */
export async function fetchSub2ApiBalance(
  apiKey: string,
  baseUrl: string | null,
): Promise<Sub2ApiBalanceInfo | null> {
  const normalizedBase = normalizeSub2ApiBaseUrl(baseUrl)
  for (const path of SUB2API_BALANCE_ENDPOINTS) {
    try {
      const response = await fetchWithConnectTimeout(`${normalizedBase}${path}`, {
        method: 'GET',
        headers: balanceHeaders(apiKey),
        // Never forward either credential header to a redirect target. A
        // canonical Base URL is required for this administrative query.
        redirect: 'error',
      }, BALANCE_TIMEOUT_MS)
      if (!response.ok) {
        if (response.body) await response.body.cancel().catch(() => undefined)
        continue
      }
      const payload: unknown = await response.json()
      const parsed = parseSub2ApiBalanceResponse(payload, path)
      if (parsed) return parsed
    } catch {
      // A deployment may not expose every compatibility endpoint. Continue
      // without logging response bodies or credentials.
    }
  }
  return null
}

/** Validates the sanitized balance snapshot persisted under account metadata. */
export function sub2ApiBalanceFromMetadata(metadata: unknown): Sub2ApiBalanceSnapshot | null {
  const object = objectValue(metadata)
  const value = objectValue(object?.sub2apiBalance)
  if (!value) return null
  const updatedAt = finiteNumber(value.updatedAt)
  if (updatedAt === undefined || updatedAt <= 0) return null
  const snapshot: Sub2ApiBalanceSnapshot = { updatedAt: Math.trunc(updatedAt) }
  for (const key of ['totalBalance', 'used', 'remaining'] as const) {
    const parsed = finiteNumber(value[key])
    if (parsed !== undefined) snapshot[key] = parsed
  }
  const resetAt = finiteNumber(value.resetAt)
  if (resetAt !== undefined) snapshot.resetAt = resetAt
  const expiresAt = finiteNumber(value.expiresAt)
  if (expiresAt !== undefined) snapshot.expiresAt = expiresAt
  if (value.unlimited === true) snapshot.unlimited = true
  if (typeof value.hasSubscription === 'boolean') snapshot.hasSubscription = value.hasSubscription
  if (typeof value.planName === 'string') snapshot.planName = value.planName
  if (typeof value.currency === 'string') snapshot.currency = value.currency
  if (typeof value.mode === 'string') snapshot.mode = value.mode
  if (typeof value.endpoint === 'string') snapshot.endpoint = value.endpoint
  if (
    snapshot.remaining === undefined &&
    snapshot.totalBalance === undefined &&
    snapshot.used === undefined &&
    snapshot.unlimited !== true &&
    snapshot.mode !== 'unrestricted' &&
    snapshot.mode !== 'quota_limited'
  ) {
    return null
  }
  return snapshot
}

export function formatBalanceInfo(info: Sub2ApiBalanceInfo | null): string {
  if (!info) return '无法获取余额信息'
  const parts: string[] = []
  if (info.unlimited) parts.push('不限额')
  if (info.remaining !== undefined) parts.push(`剩余: $${info.remaining.toFixed(2)}`)
  if (info.totalBalance !== undefined) parts.push(`总额: $${info.totalBalance.toFixed(2)}`)
  if (info.used !== undefined) parts.push(`已用: $${info.used.toFixed(2)}`)
  if (info.hasSubscription) parts.push('有订阅')
  if (info.planName) parts.push(`计划: ${info.planName}`)
  if (info.resetAt) parts.push(`重置: ${new Date(info.resetAt).toLocaleDateString('zh-CN')}`)
  if (info.expiresAt) parts.push(`到期: ${new Date(info.expiresAt).toLocaleDateString('zh-CN')}`)
  return parts.length ? parts.join(' | ') : '无余额信息'
}
