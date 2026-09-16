/**
 * Provider-agnostic upstream balance primitives.
 *
 * Two very different upstreams end up in the same "余额 / 配额" column: the
 * Sub2API gateway reports the effective credit of a key or subscription
 * (`/v1/usage`), while DeepSeek reports the wallet of an official platform
 * account (`/user/balance`). Both are normalized into `AccountBalanceInfo` and
 * persisted as an `AccountBalanceSnapshot` under the account's metadata, so the
 * shape, the numeric parsing, the sanitizing read-back and the display
 * formatting live here instead of inside one provider.
 */
import { UnsafeUpstreamUrlError } from '../http/urlGuard'

export interface AccountBalanceInfo {
  /** Total credit/limit in the upstream billing currency. */
  totalBalance?: number
  /** Amount already used, when the upstream reports it. */
  used?: number
  /** Remaining credit/limit. */
  remaining?: number
  /** Granted (promotional) credit still available, when the upstream splits it. */
  granted?: number
  /** Optional quota reset timestamp (epoch milliseconds). */
  resetAt?: number
  /** Optional key/subscription expiration timestamp (epoch milliseconds). */
  expiresAt?: number
  /** True when the upstream subscription explicitly reports no monetary limit. */
  unlimited?: boolean
  /** Whether the upstream reports an active subscription. */
  hasSubscription?: boolean
  /**
   * Whether the upstream currently accepts API calls with this balance. DeepSeek
   * reports `is_available: false` for an exhausted wallet.
   */
  available?: boolean
  /** Human-readable upstream plan name. */
  planName?: string
  /** Currency returned by the upstream (normally USD; DeepSeek may report CNY). */
  currency?: string
  /** Upstream response mode, for example `quota_limited`. */
  mode?: string
  /** Endpoint that returned the snapshot (never contains credentials). */
  endpoint?: string
}

export interface AccountBalanceSnapshot extends AccountBalanceInfo {
  /** Local observation time (epoch milliseconds). */
  updatedAt: number
  /** Provider that reported the snapshot, filled in by the caller. */
  provider?: string
}

/**
 * Providers whose credential can query a monetary balance. Everything else
 * exposes quota windows (Claude / OpenAI / MiniMax / Antigravity) or has no
 * queryable balance endpoint (Gemini, xAI and the Anthropic-compatible domestic
 * vendors), and keeps using the generic quota route.
 */
export const BALANCE_PROVIDERS = ['sub2api', 'deepseek'] as const

export type BalanceProvider = (typeof BALANCE_PROVIDERS)[number]

/** True when the account can report a monetary balance instead of quota windows. */
export function usesUpstreamBalance(provider: string): provider is BalanceProvider {
  return (BALANCE_PROVIDERS as readonly string[]).includes(provider)
}

export function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = finiteNumber(value)
    if (parsed !== undefined) return parsed
  }
  return undefined
}

/** Accepts epoch seconds, epoch milliseconds, or an ISO date string. */
export function parseTimestamp(value: unknown): number | undefined {
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

/**
 * Derives the missing side of the total/used/remaining triangle so the UI can
 * always show a consistent set of numbers.
 */
export function reconcileBalanceAmounts(result: AccountBalanceInfo): void {
  if (result.totalBalance !== undefined && result.remaining !== undefined && result.used === undefined) {
    result.used = result.totalBalance - result.remaining
  }
  if (result.totalBalance !== undefined && result.used !== undefined && result.remaining === undefined) {
    result.remaining = result.totalBalance - result.used
  }
  if (result.used !== undefined && result.remaining !== undefined && result.totalBalance === undefined) {
    result.totalBalance = result.used + result.remaining
  }
}

export function balanceRequestHeaders(apiKey: string): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    'x-api-key': apiKey,
    accept: 'application/json',
  }
}

/** Sanitized failure text for a balance query (never echoes credentials or bodies). */
export function balanceQueryFailureMessage(error: unknown, endpoint: string, timeoutMs = 15_000): string {
  if (error instanceof UnsafeUpstreamUrlError) {
    return `${endpoint} 被上游地址安全策略拦截：${error.message}`
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return `${endpoint} 请求超时（${timeoutMs / 1000}s）`
  }
  const cause = error instanceof Error
    ? (error as Error & { cause?: { code?: unknown; message?: unknown } }).cause
    : undefined
  if (cause?.message === 'unexpected redirect') {
    return `${endpoint} 返回重定向，请将 Base URL 改为最终 HTTPS 地址`
  }
  if (typeof cause?.code === 'string' && /^[A-Z0-9_]+$/.test(cause.code)) {
    return `${endpoint} 网络请求失败（${cause.code}）`
  }
  return `${endpoint} 网络请求失败`
}

/**
 * Validates the sanitized balance snapshot persisted under account metadata.
 * Returns null when the value carries no usable balance information, so a
 * corrupt or half-written snapshot never renders as "余额 $0".
 */
export function balanceSnapshotFromMetadata(
  metadata: unknown,
  key = 'upstreamBalance',
): AccountBalanceSnapshot | null {
  const object = objectValue(metadata)
  const value = objectValue(object?.[key])
  if (!value) return null
  const updatedAt = finiteNumber(value.updatedAt)
  if (updatedAt === undefined || updatedAt <= 0) return null
  const snapshot: AccountBalanceSnapshot = { updatedAt: Math.trunc(updatedAt) }
  for (const field of ['totalBalance', 'used', 'remaining', 'granted'] as const) {
    const parsed = finiteNumber(value[field])
    if (parsed !== undefined) snapshot[field] = parsed
  }
  const resetAt = finiteNumber(value.resetAt)
  if (resetAt !== undefined) snapshot.resetAt = resetAt
  const expiresAt = finiteNumber(value.expiresAt)
  if (expiresAt !== undefined) snapshot.expiresAt = expiresAt
  if (value.unlimited === true) snapshot.unlimited = true
  if (value.available === false) snapshot.available = false
  if (typeof value.hasSubscription === 'boolean') snapshot.hasSubscription = value.hasSubscription
  if (typeof value.planName === 'string') snapshot.planName = value.planName
  if (typeof value.currency === 'string') snapshot.currency = value.currency
  if (typeof value.mode === 'string') snapshot.mode = value.mode
  if (typeof value.endpoint === 'string') snapshot.endpoint = value.endpoint
  if (typeof value.provider === 'string') snapshot.provider = value.provider
  if (
    snapshot.remaining === undefined &&
    snapshot.totalBalance === undefined &&
    snapshot.used === undefined &&
    snapshot.unlimited !== true &&
    snapshot.available !== false &&
    snapshot.mode !== 'unrestricted' &&
    snapshot.mode !== 'quota_limited'
  ) {
    return null
  }
  return snapshot
}

/**
 * Snapshot shown in the admin accounts table. Snapshots written before the
 * balance column was generalized live under the legacy `sub2apiBalance` key, so
 * that key stays readable for migration.
 */
export function upstreamBalanceFromMetadata(metadata: unknown): AccountBalanceSnapshot | null {
  const record = objectValue(metadata)
  if (!record) return null
  if (record.upstreamBalance !== undefined) return balanceSnapshotFromMetadata(record)
  return balanceSnapshotFromMetadata(record, 'sub2apiBalance')
}

/** Single-line, credential-free summary used in logs and API messages. */
export function formatBalanceInfo(info: AccountBalanceInfo | null): string {
  if (!info) return '无法获取余额信息'
  if (info.available === false) return '余额不足，上游已停止服务'
  const parts: string[] = []
  if (info.unlimited) parts.push('不限额')
  if (info.remaining !== undefined) parts.push(`剩余: $${info.remaining.toFixed(2)}`)
  if (info.totalBalance !== undefined) parts.push(`总额: $${info.totalBalance.toFixed(2)}`)
  if (info.granted !== undefined) parts.push(`赠送: $${info.granted.toFixed(2)}`)
  if (info.used !== undefined) parts.push(`已用: $${info.used.toFixed(2)}`)
  if (info.hasSubscription) parts.push('有订阅')
  if (info.planName) parts.push(`计划: ${info.planName}`)
  if (info.resetAt) parts.push(`重置: ${new Date(info.resetAt).toLocaleDateString('zh-CN')}`)
  if (info.expiresAt) parts.push(`到期: ${new Date(info.expiresAt).toLocaleDateString('zh-CN')}`)
  return parts.length ? parts.join(' | ') : '无余额信息'
}
