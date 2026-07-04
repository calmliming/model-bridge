/**
 * OAuth token 刷新失败的「永久 vs 临时」分类。
 *
 * 后台刷新任务与 relay 两条路径共用这里的判定：命中永久信号即禁用账号并标记
 * 「需重新授权」；其余一律按临时失败处理（保持重试）。分类器是纯函数，不碰
 * 网络与数据库，便于单测。
 */

/**
 * 永久失效信号：token 不可能自愈，需人工重新授权。命中即禁用账号。
 * 以 sub2api 的 `isNonRetryableRefreshError` 为蓝本，外加 OpenAI 的
 * `refresh_token_invalidated`（对应 sub2api 提交 0a97a5f）。
 */
const PERMANENT_REFRESH_SIGNALS = [
  'invalid_grant', // refresh_token 已失效（最常见）
  'invalid_refresh_token', // team 工作区被删等
  'token_expired', // OpenAI refresh_token 已过期，需要重新授权
  'refresh_token_invalidated', // OpenAI 会话终止，refresh token 作废
  'refresh_token_reused', // refresh_token 已被使用，必须重新授权
  'app_session_terminated', // team 账号工作区被删除
  'invalid_client', // 客户端配置错误
  'unauthorized_client', // 客户端未授权
  'access_denied', // 授权被拒绝
  'account has no refresh token', // 本地就没有 refresh token
] as const

/** 账号 metadata 里记录的「需重新授权」标记。 */
export interface AccountReauthState {
  required: boolean
  /** 命中的永久失效信号，用于展示与排查。 */
  reason: string
  /** 触发禁用的 provider id。 */
  provider: string
  /** 判定时间（epoch ms）。 */
  at: number
}

/**
 * refresh token 永久失效时抛出的类型化错误。relay 靠 `instanceof` 识别它，
 * 从而跳过 penalize（否则会把 disabled 复活成 error + cooldown）。
 */
export class PermanentRefreshError extends Error {
  constructor(
    readonly accountId: string,
    readonly signal: string,
    readonly status?: number,
  ) {
    super(`refresh token permanently invalid for account ${accountId} (${signal})`)
    this.name = 'PermanentRefreshError'
  }
}

/**
 * 从 provider 抛出的通用 Error 判定永久/临时。
 * fail-safe：任何不在永久信号列表里的错误一律按 transient，宁可多重试也不误禁。
 * 返回命中的 signal（用于日志与 metadata），非永久返回 null。
 */
export function matchPermanentRefreshSignal(err: unknown): string | null {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return PERMANENT_REFRESH_SIGNALS.find((s) => msg.includes(s)) ?? null
}

/**
 * 尽力从刷新错误里解析上游 HTTP 状态码（provider 抛出的格式为
 * `token refresh failed (429): ...`）。用于日志摘要，取不到返回 undefined。
 */
export function refreshFailureStatus(err: unknown): number | undefined {
  const msg = err instanceof Error ? err.message : String(err)
  const match = msg.match(/\((\d{3})\)/)
  return match ? Number(match[1]) : undefined
}

/** 从账号 metadata 读取「需重新授权」标记，未标记返回 null。 */
export function reauthStateFromMetadata(metadata: unknown): AccountReauthState | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const reauth = (metadata as Record<string, unknown>).reauth
  if (!reauth || typeof reauth !== 'object') return null
  const state = reauth as Record<string, unknown>
  if (state.required !== true) return null
  return {
    required: true,
    reason: typeof state.reason === 'string' ? state.reason : 'unknown',
    provider: typeof state.provider === 'string' ? state.provider : '',
    at: typeof state.at === 'number' ? state.at : 0,
  }
}
