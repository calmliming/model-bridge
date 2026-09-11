import type { AccountQuotaSnapshot, AccountQuotaWindow } from '../../accounts/quota'
import { fetchWithConnectTimeout } from '../../http/upstream'
import { minimaxBaseUrl } from './relay'

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function numeric(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function resetAt(value: unknown): number | null {
  const n = numeric(value)
  if (n != null) return n > 0 ? n < 1e12 ? n * 1000 : n : null
  const date = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(date) ? date : null
}

/** MiniMax reports remaining percentages; media quotas must not pause text accounts. */
export function parseMiniMaxQuota(data: unknown, now = Date.now()): AccountQuotaSnapshot {
  const body = record(data)
  if (!body) throw new Error('MiniMax 额度返回格式无效')
  const status = record(body.base_resp)?.status_code
  if (status != null && Number(status) !== 0) {
    throw new Error(`MiniMax 额度查询失败（代码 ${Number(status)}），请确认 Token Plan / Coding Plan 密钥`)
  }
  const general = Array.isArray(body.model_remains)
    ? body.model_remains.map(record).find(item => typeof item?.model_name === 'string' && item.model_name.trim().toLowerCase() === 'general') : null
  if (!general) throw new Error('MiniMax 未返回编程套餐额度，请确认账号已开通 Token Plan / Coding Plan')
  const windows: AccountQuotaWindow[] = []
  const add = (key: 'hourly' | 'weekly', remaining: unknown, reset: unknown) => {
    const n = numeric(remaining)
    if (n == null || n < 0 || n > 100) return
    windows.push({ key, label: key === 'hourly' ? '5小时' : '7天', usedPercent: 100 - n, resetAt: resetAt(reset), exceeded: n === 0 })
  }
  add('hourly', general.current_interval_remaining_percent, general.end_time)
  if (Number(general.current_weekly_status) === 1) {
    add('weekly', general.current_weekly_remaining_percent, general.weekly_end_time)
  }
  if (!windows.length) throw new Error('MiniMax 未返回有效额度窗口')
  return { source: 'minimax', updatedAt: now, windows }
}

export async function fetchMiniMaxQuota(apiKey: string, baseUrl?: string | null): Promise<AccountQuotaSnapshot> {
  const response = await fetchWithConnectTimeout(`${minimaxBaseUrl(baseUrl)}/v1/api/openplatform/coding_plan/remains`, {
    headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json', 'content-type': 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`MiniMax 额度查询失败（HTTP ${response.status}）`)
  return parseMiniMaxQuota(await response.json())
}
