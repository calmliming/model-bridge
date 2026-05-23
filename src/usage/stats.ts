import { sqlite } from '../db/index'

export interface DailyStat {
  day: string // YYYY-MM-DD (UTC)
  requests: number
  inputTokens: number
  outputTokens: number
  cost: number
}

export interface ProviderStat {
  provider: string
  requests: number
  tokens: number
  cost: number
}

export interface ModelStat {
  model: string
  requests: number
  tokens: number
  cost: number
}

export interface KeyStat {
  id: string
  name: string
  ownerLabel: string | null
  requests: number
  tokens: number
  cost: number
}

export interface StatsSummary {
  rangeDays: number
  totals: { requests: number; inputTokens: number; outputTokens: number; cost: number }
  daily: DailyStat[]
  byProvider: ProviderStat[]
  byModel: ModelStat[]
  byKey: KeyStat[]
}

const MS_PER_DAY = 86_400_000

function utcDayKey(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10)
}

function clampDays(days: number): number {
  if (!Number.isFinite(days)) return 30
  return Math.max(1, Math.min(365, Math.floor(days)))
}

/**
 * Per-day usage for the last `days` days (UTC). Returns a contiguous
 * series with zero-filled gaps so the chart has no holes.
 */
export function dailyStats(days: number): DailyStat[] {
  const range = clampDays(days)
  const since = Date.now() - range * MS_PER_DAY
  const rows = sqlite
    .prepare(
      `SELECT date(ts / 1000, 'unixepoch') AS day,
              COUNT(*) AS requests,
              COALESCE(SUM(input_tokens), 0) AS inputTokens,
              COALESCE(SUM(output_tokens), 0) AS outputTokens,
              COALESCE(SUM(cost), 0) AS cost
       FROM usage_logs
       WHERE ts >= ?
       GROUP BY day
       ORDER BY day`,
    )
    .all(since) as DailyStat[]
  const byDay = new Map(rows.map((r) => [r.day, r]))
  const out: DailyStat[] = []
  for (let i = range - 1; i >= 0; i--) {
    const day = utcDayKey(Date.now() - i * MS_PER_DAY)
    out.push(byDay.get(day) ?? { day, requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 })
  }
  return out
}

export function statsByProvider(days: number): ProviderStat[] {
  const since = Date.now() - clampDays(days) * MS_PER_DAY
  return sqlite
    .prepare(
      `SELECT provider,
              COUNT(*) AS requests,
              COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
              COALESCE(SUM(cost), 0) AS cost
       FROM usage_logs
       WHERE ts >= ?
       GROUP BY provider
       ORDER BY tokens DESC`,
    )
    .all(since) as ProviderStat[]
}

export function statsByModel(days: number, limit = 10): ModelStat[] {
  const since = Date.now() - clampDays(days) * MS_PER_DAY
  return sqlite
    .prepare(
      `SELECT COALESCE(model, '(unknown)') AS model,
              COUNT(*) AS requests,
              COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
              COALESCE(SUM(cost), 0) AS cost
       FROM usage_logs
       WHERE ts >= ?
       GROUP BY model
       ORDER BY tokens DESC
       LIMIT ?`,
    )
    .all(since, limit) as ModelStat[]
}

export function statsByKey(days: number): KeyStat[] {
  const since = Date.now() - clampDays(days) * MS_PER_DAY
  return sqlite
    .prepare(
      `SELECT api_keys.id AS id,
              api_keys.name AS name,
              api_keys.owner_label AS ownerLabel,
              COUNT(usage_logs.id) AS requests,
              COALESCE(SUM(usage_logs.input_tokens + usage_logs.output_tokens), 0) AS tokens,
              COALESCE(SUM(usage_logs.cost), 0) AS cost
       FROM api_keys
       LEFT JOIN usage_logs
              ON usage_logs.api_key_id = api_keys.id
             AND usage_logs.ts >= ?
       GROUP BY api_keys.id
       ORDER BY tokens DESC, name`,
    )
    .all(since) as KeyStat[]
}

export function statsSummary(days: number): StatsSummary {
  const range = clampDays(days)
  const since = Date.now() - range * MS_PER_DAY
  const totals = sqlite
    .prepare(
      `SELECT COUNT(*) AS requests,
              COALESCE(SUM(input_tokens), 0) AS inputTokens,
              COALESCE(SUM(output_tokens), 0) AS outputTokens,
              COALESCE(SUM(cost), 0) AS cost
       FROM usage_logs WHERE ts >= ?`,
    )
    .get(since) as { requests: number; inputTokens: number; outputTokens: number; cost: number }
  return {
    rangeDays: range,
    totals,
    daily: dailyStats(range),
    byProvider: statsByProvider(range),
    byModel: statsByModel(range),
    byKey: statsByKey(range),
  }
}
