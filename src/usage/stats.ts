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

export interface DashboardAccount {
  id: string
  provider: string
  name: string
  status: string
  cooldownUntil: number | null
  tokenExpiresAt: number | null
  lastUsedAt: number | null
  createdAt: number
}

export interface DashboardKey {
  id: string
  name: string
  ownerLabel: string | null
  keyPrefix: string
  enabled: boolean
  quotaLimit: number | null
  quotaUsed: number
  lastUsedAt: number | null
  requests: number
  tokens: number
  cost: number
}

export interface DashboardRecentLog {
  id: string
  ts: number
  provider: string
  model: string | null
  status: string
  latencyMs: number | null
  cost: number
  apiKeyName: string | null
  accountName: string | null
}

export interface DashboardOverview {
  totals: {
    keyCount: number
    enabledKeyCount: number
    accountCount: number
    activeAccountCount: number
    coolingAccountCount: number
    disabledAccountCount: number
    errorAccountCount: number
    requestCount: number
    requests24h: number
    tokens30d: number
    cost30d: number
  }
  daily: DailyStat[]
  byProvider: ProviderStat[]
  accounts: DashboardAccount[]
  keys: DashboardKey[]
  recentLogs: DashboardRecentLog[]
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

/** Compact, mixed-source data used by the dashboard landing page. */
export function dashboardOverview(): DashboardOverview {
  const now = Date.now()
  const since24h = now - MS_PER_DAY
  const since30d = now - 30 * MS_PER_DAY
  const totals = sqlite
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM api_keys) AS keyCount,
         (SELECT COUNT(*) FROM api_keys WHERE enabled = 1) AS enabledKeyCount,
         (SELECT COUNT(*) FROM accounts) AS accountCount,
         (SELECT COUNT(*) FROM accounts
            WHERE status != 'disabled'
              AND (cooldown_until IS NULL OR cooldown_until <= ?)) AS activeAccountCount,
         (SELECT COUNT(*) FROM accounts
            WHERE status != 'disabled'
              AND cooldown_until IS NOT NULL
              AND cooldown_until > ?) AS coolingAccountCount,
         (SELECT COUNT(*) FROM accounts WHERE status = 'disabled') AS disabledAccountCount,
         (SELECT COUNT(*) FROM accounts WHERE status = 'error') AS errorAccountCount,
         (SELECT COUNT(*) FROM usage_logs) AS requestCount,
         (SELECT COUNT(*) FROM usage_logs WHERE ts >= ?) AS requests24h,
         (SELECT COALESCE(SUM(input_tokens + output_tokens), 0)
            FROM usage_logs WHERE ts >= ?) AS tokens30d,
         (SELECT COALESCE(SUM(cost), 0)
            FROM usage_logs WHERE ts >= ?) AS cost30d`,
    )
    .get(now, now, since24h, since30d, since30d) as DashboardOverview['totals']

  const accounts = sqlite
    .prepare(
      `SELECT id,
              provider,
              name,
              status,
              cooldown_until AS cooldownUntil,
              token_expires_at AS tokenExpiresAt,
              last_used_at AS lastUsedAt,
              created_at AS createdAt
       FROM accounts
       ORDER BY
         CASE
           WHEN status = 'error' THEN 0
           WHEN status != 'disabled'
             AND cooldown_until IS NOT NULL
             AND cooldown_until > ? THEN 1
           WHEN status = 'disabled' THEN 3
           ELSE 2
         END,
         COALESCE(last_used_at, created_at) DESC
       LIMIT 8`,
    )
    .all(now) as DashboardAccount[]

  const keys = sqlite
    .prepare(
      `SELECT api_keys.id AS id,
              api_keys.name AS name,
              api_keys.owner_label AS ownerLabel,
              api_keys.key_prefix AS keyPrefix,
              api_keys.enabled AS enabled,
              api_keys.quota_limit AS quotaLimit,
              api_keys.quota_used AS quotaUsed,
              api_keys.last_used_at AS lastUsedAt,
              COUNT(usage_logs.id) AS requests,
              COALESCE(SUM(usage_logs.input_tokens + usage_logs.output_tokens), 0) AS tokens,
              COALESCE(SUM(usage_logs.cost), 0) AS cost
       FROM api_keys
       LEFT JOIN usage_logs
              ON usage_logs.api_key_id = api_keys.id
             AND usage_logs.ts >= ?
       GROUP BY api_keys.id
       ORDER BY cost DESC, api_keys.quota_used DESC, api_keys.last_used_at DESC
       LIMIT 6`,
    )
    .all(since30d)
    .map((row) => ({
      ...(row as Omit<DashboardKey, 'enabled'> & { enabled: number }),
      enabled: Boolean((row as { enabled: number }).enabled),
    })) as DashboardKey[]

  const recentLogs = sqlite
    .prepare(
      `SELECT usage_logs.id AS id,
              usage_logs.ts AS ts,
              usage_logs.provider AS provider,
              usage_logs.model AS model,
              usage_logs.status AS status,
              usage_logs.latency_ms AS latencyMs,
              usage_logs.cost AS cost,
              api_keys.name AS apiKeyName,
              accounts.name AS accountName
       FROM usage_logs
       LEFT JOIN api_keys ON api_keys.id = usage_logs.api_key_id
       LEFT JOIN accounts ON accounts.id = usage_logs.account_id
       ORDER BY usage_logs.ts DESC
       LIMIT 8`,
    )
    .all() as DashboardRecentLog[]

  return {
    totals,
    daily: dailyStats(14),
    byProvider: statsByProvider(30),
    accounts,
    keys,
    recentLogs,
  }
}
