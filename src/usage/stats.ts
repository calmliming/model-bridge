import { pool } from '../db/index'

export interface DailyStat {
  day: string // YYYY-MM-DD (UTC)
  requests: number
  inputTokens: number
  outputTokens: number
  cacheCreateTokens: number
  cacheReadTokens: number
  cost: number
}

export interface ProviderStat {
  provider: string
  requests: number
  tokens: number
  inputTokens: number
  outputTokens: number
  cacheCreateTokens: number
  cacheReadTokens: number
  cost: number
}

export interface ModelStat {
  model: string
  requests: number
  tokens: number
  inputTokens: number
  outputTokens: number
  cacheCreateTokens: number
  cacheReadTokens: number
  cost: number
}

export interface KeyStat {
  id: string
  name: string
  ownerLabel: string | null
  requests: number
  tokens: number
  inputTokens: number
  outputTokens: number
  cacheCreateTokens: number
  cacheReadTokens: number
  cost: number
}

export interface StatsSummary {
  rangeDays: number
  totals: {
    requests: number
    inputTokens: number
    outputTokens: number
    cacheCreateTokens: number
    cacheReadTokens: number
    cost: number
  }
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
  inputTokens: number
  outputTokens: number
  cacheCreateTokens: number
  cacheReadTokens: number
  cost: number
  apiKeyName: string | null
  accountName: string | null
  requestInput: string | null
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
}

export interface DashboardRecentLogsPage {
  page: number
  pageSize: number
  total: number
  logs: DashboardRecentLog[]
}

const MS_PER_DAY = 86_400_000

function utcDayKey(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10)
}

function utcDayStart(timestampMs: number): number {
  const d = new Date(timestampMs)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

function rangeStart(days: number): number {
  const range = clampDays(days)
  return utcDayStart(Date.now()) - (range - 1) * MS_PER_DAY
}

function clampDays(days: number): number {
  if (!Number.isFinite(days)) return 30
  return Math.max(1, Math.min(365, Math.floor(days)))
}

// pg returns NUMERIC and SUM(BIGINT) as strings to preserve precision. Most of
// our totals fit in JS Number safely, and downstream code expects numbers, so
// normalize each numeric column here.
function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return v
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function asDaily(row: Record<string, unknown>): DailyStat {
  return {
    day: row.day as string,
    requests: toNum(row.requests),
    inputTokens: toNum(row.inputtokens),
    outputTokens: toNum(row.outputtokens),
    cacheCreateTokens: toNum(row.cachecreatetokens),
    cacheReadTokens: toNum(row.cachereadtokens),
    cost: toNum(row.cost),
  }
}

function asProvider(row: Record<string, unknown>): ProviderStat {
  return {
    provider: row.provider as string,
    requests: toNum(row.requests),
    tokens: toNum(row.tokens),
    inputTokens: toNum(row.inputtokens),
    outputTokens: toNum(row.outputtokens),
    cacheCreateTokens: toNum(row.cachecreatetokens),
    cacheReadTokens: toNum(row.cachereadtokens),
    cost: toNum(row.cost),
  }
}

function asModel(row: Record<string, unknown>): ModelStat {
  return {
    model: row.model as string,
    requests: toNum(row.requests),
    tokens: toNum(row.tokens),
    inputTokens: toNum(row.inputtokens),
    outputTokens: toNum(row.outputtokens),
    cacheCreateTokens: toNum(row.cachecreatetokens),
    cacheReadTokens: toNum(row.cachereadtokens),
    cost: toNum(row.cost),
  }
}

function asKey(row: Record<string, unknown>): KeyStat {
  return {
    id: row.id as string,
    name: row.name as string,
    ownerLabel: (row.ownerlabel as string | null) ?? null,
    requests: toNum(row.requests),
    tokens: toNum(row.tokens),
    inputTokens: toNum(row.inputtokens),
    outputTokens: toNum(row.outputtokens),
    cacheCreateTokens: toNum(row.cachecreatetokens),
    cacheReadTokens: toNum(row.cachereadtokens),
    cost: toNum(row.cost),
  }
}

function asDashboardRecentLog(row: Record<string, unknown>): DashboardRecentLog {
  return {
    id: row.id as string,
    ts: toNum(row.ts),
    provider: row.provider as string,
    model: (row.model as string | null) ?? null,
    status: row.status as string,
    latencyMs: row.latencyms == null ? null : toNum(row.latencyms),
    inputTokens: toNum(row.inputtokens),
    outputTokens: toNum(row.outputtokens),
    cacheCreateTokens: toNum(row.cachecreatetokens),
    cacheReadTokens: toNum(row.cachereadtokens),
    cost: toNum(row.cost),
    apiKeyName: (row.apikeyname as string | null) ?? null,
    accountName: (row.accountname as string | null) ?? null,
    requestInput: (row.requestinput as string | null) ?? null,
  }
}

/**
 * Per-day usage for the last `days` days (UTC). Returns a contiguous
 * series with zero-filled gaps so the chart has no holes.
 */
export async function dailyStats(days: number): Promise<DailyStat[]> {
  const range = clampDays(days)
  const since = rangeStart(range)
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT to_char(to_timestamp(ts / 1000), 'YYYY-MM-DD') AS day,
            COUNT(*) AS requests,
            COALESCE(SUM(input_tokens), 0) AS inputTokens,
            COALESCE(SUM(output_tokens), 0) AS outputTokens,
            COALESCE(SUM(cache_create_tokens), 0) AS cacheCreateTokens,
            COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens,
            COALESCE(SUM(cost), 0) AS cost
     FROM usage_logs
     WHERE ts >= $1
     GROUP BY day
     ORDER BY day`,
    [since],
  )
  const byDay = new Map(rows.map((r) => [r.day as string, asDaily(r)]))
  const out: DailyStat[] = []
  for (let i = range - 1; i >= 0; i--) {
    const day = utcDayKey(Date.now() - i * MS_PER_DAY)
    out.push(
      byDay.get(day) ?? {
        day,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreateTokens: 0,
        cacheReadTokens: 0,
        cost: 0,
      },
    )
  }
  return out
}

export async function statsByProvider(days: number): Promise<ProviderStat[]> {
  const since = rangeStart(days)
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT provider,
            COUNT(*) AS requests,
            COALESCE(SUM(input_tokens + output_tokens + cache_create_tokens + cache_read_tokens), 0) AS tokens,
            COALESCE(SUM(input_tokens), 0) AS inputTokens,
            COALESCE(SUM(output_tokens), 0) AS outputTokens,
            COALESCE(SUM(cache_create_tokens), 0) AS cacheCreateTokens,
            COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens,
            COALESCE(SUM(cost), 0) AS cost
     FROM usage_logs
     WHERE ts >= $1
     GROUP BY provider
     ORDER BY tokens DESC`,
    [since],
  )
  return rows.map(asProvider)
}

export async function statsByModel(days: number, limit = 10): Promise<ModelStat[]> {
  const since = rangeStart(days)
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT COALESCE(model, '(unknown)') AS model,
            COUNT(*) AS requests,
            COALESCE(SUM(input_tokens + output_tokens + cache_create_tokens + cache_read_tokens), 0) AS tokens,
            COALESCE(SUM(input_tokens), 0) AS inputTokens,
            COALESCE(SUM(output_tokens), 0) AS outputTokens,
            COALESCE(SUM(cache_create_tokens), 0) AS cacheCreateTokens,
            COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens,
            COALESCE(SUM(cost), 0) AS cost
     FROM usage_logs
     WHERE ts >= $1
     GROUP BY model
     ORDER BY tokens DESC
     LIMIT $2`,
    [since, limit],
  )
  return rows.map(asModel)
}

export async function statsByKey(days: number): Promise<KeyStat[]> {
  const since = rangeStart(days)
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT api_keys.id AS id,
            api_keys.name AS name,
            api_keys.owner_label AS ownerLabel,
            COUNT(usage_logs.id) AS requests,
            COALESCE(SUM(usage_logs.input_tokens + usage_logs.output_tokens + usage_logs.cache_create_tokens + usage_logs.cache_read_tokens), 0) AS tokens,
            COALESCE(SUM(usage_logs.input_tokens), 0) AS inputTokens,
            COALESCE(SUM(usage_logs.output_tokens), 0) AS outputTokens,
            COALESCE(SUM(usage_logs.cache_create_tokens), 0) AS cacheCreateTokens,
            COALESCE(SUM(usage_logs.cache_read_tokens), 0) AS cacheReadTokens,
            COALESCE(SUM(usage_logs.cost), 0) AS cost
     FROM api_keys
     LEFT JOIN usage_logs
            ON usage_logs.api_key_id = api_keys.id
           AND usage_logs.ts >= $1
     GROUP BY api_keys.id
     ORDER BY tokens DESC, name`,
    [since],
  )
  return rows.map(asKey)
}

export async function statsSummary(days: number): Promise<StatsSummary> {
  const range = clampDays(days)
  const since = rangeStart(range)
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT COUNT(*) AS requests,
            COALESCE(SUM(input_tokens), 0) AS inputTokens,
            COALESCE(SUM(output_tokens), 0) AS outputTokens,
            COALESCE(SUM(cache_create_tokens), 0) AS cacheCreateTokens,
            COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens,
            COALESCE(SUM(cost), 0) AS cost
     FROM usage_logs WHERE ts >= $1`,
    [since],
  )
  const r = rows[0] ?? {}
  const totals = {
    requests: toNum(r.requests),
    inputTokens: toNum(r.inputtokens),
    outputTokens: toNum(r.outputtokens),
    cacheCreateTokens: toNum(r.cachecreatetokens),
    cacheReadTokens: toNum(r.cachereadtokens),
    cost: toNum(r.cost),
  }
  const [daily, byProvider, byModel, byKey] = await Promise.all([
    dailyStats(range),
    statsByProvider(range),
    statsByModel(range),
    statsByKey(range),
  ])
  return { rangeDays: range, totals, daily, byProvider, byModel, byKey }
}

/** Compact, mixed-source data used by the dashboard landing page. */
export async function dashboardOverview(): Promise<DashboardOverview> {
  const now = Date.now()
  const since24h = now - MS_PER_DAY
  const since30d = now - 30 * MS_PER_DAY

  const totalsRes = await pool.query<Record<string, unknown>>(
    `SELECT
       (SELECT COUNT(*) FROM api_keys) AS keyCount,
       (SELECT COUNT(*) FROM api_keys WHERE enabled = TRUE) AS enabledKeyCount,
       (SELECT COUNT(*) FROM accounts) AS accountCount,
       (SELECT COUNT(*) FROM accounts
          WHERE status != 'disabled'
            AND (cooldown_until IS NULL OR cooldown_until <= $1)) AS activeAccountCount,
       (SELECT COUNT(*) FROM accounts
          WHERE status != 'disabled'
            AND cooldown_until IS NOT NULL
            AND cooldown_until > $2) AS coolingAccountCount,
       (SELECT COUNT(*) FROM accounts WHERE status = 'disabled') AS disabledAccountCount,
       (SELECT COUNT(*) FROM accounts WHERE status = 'error') AS errorAccountCount,
       (SELECT COUNT(*) FROM usage_logs) AS requestCount,
       (SELECT COUNT(*) FROM usage_logs WHERE ts >= $3) AS requests24h,
       (SELECT COALESCE(SUM(input_tokens + output_tokens), 0)
          FROM usage_logs WHERE ts >= $4) AS tokens30d,
       (SELECT COALESCE(SUM(cost), 0)
          FROM usage_logs WHERE ts >= $5) AS cost30d`,
    [now, now, since24h, since30d, since30d],
  )
  const t = totalsRes.rows[0] ?? {}
  const totals: DashboardOverview['totals'] = {
    keyCount: toNum(t.keycount),
    enabledKeyCount: toNum(t.enabledkeycount),
    accountCount: toNum(t.accountcount),
    activeAccountCount: toNum(t.activeaccountcount),
    coolingAccountCount: toNum(t.coolingaccountcount),
    disabledAccountCount: toNum(t.disabledaccountcount),
    errorAccountCount: toNum(t.erroraccountcount),
    requestCount: toNum(t.requestcount),
    requests24h: toNum(t.requests24h),
    tokens30d: toNum(t.tokens30d),
    cost30d: toNum(t.cost30d),
  }

  const accountsRes = await pool.query<Record<string, unknown>>(
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
           AND cooldown_until > $1 THEN 1
         WHEN status = 'disabled' THEN 3
         ELSE 2
       END,
       COALESCE(last_used_at, created_at) DESC
     LIMIT 8`,
    [now],
  )
  const accounts: DashboardAccount[] = accountsRes.rows.map((row) => ({
    id: row.id as string,
    provider: row.provider as string,
    name: row.name as string,
    status: row.status as string,
    cooldownUntil: row.cooldownuntil == null ? null : toNum(row.cooldownuntil),
    tokenExpiresAt: row.tokenexpiresat == null ? null : toNum(row.tokenexpiresat),
    lastUsedAt: row.lastusedat == null ? null : toNum(row.lastusedat),
    createdAt: toNum(row.createdat),
  }))

  const keysRes = await pool.query<Record<string, unknown>>(
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
           AND usage_logs.ts >= $1
     GROUP BY api_keys.id
     ORDER BY cost DESC, api_keys.quota_used DESC, api_keys.last_used_at DESC
     LIMIT 6`,
    [since30d],
  )
  const keys: DashboardKey[] = keysRes.rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    ownerLabel: (row.ownerlabel as string | null) ?? null,
    keyPrefix: row.keyprefix as string,
    enabled: Boolean(row.enabled),
    quotaLimit: row.quotalimit == null ? null : toNum(row.quotalimit),
    quotaUsed: toNum(row.quotaused),
    lastUsedAt: row.lastusedat == null ? null : toNum(row.lastusedat),
    requests: toNum(row.requests),
    tokens: toNum(row.tokens),
    cost: toNum(row.cost),
  }))

  const [daily, byProvider] = await Promise.all([
    dailyStats(14),
    statsByProvider(30),
  ])

  return { totals, daily, byProvider, accounts, keys }
}

export async function dashboardRecentLogs(
  page = 1,
  pageSize = 10,
): Promise<DashboardRecentLogsPage> {
  const safePage = Math.max(1, Math.floor(Number.isFinite(page) ? page : 1))
  const safePageSize = Math.max(
    1,
    Math.min(100, Math.floor(Number.isFinite(pageSize) ? pageSize : 10)),
  )
  const offset = (safePage - 1) * safePageSize

  const [totalRes, logsRes] = await Promise.all([
    pool.query<Record<string, unknown>>('SELECT COUNT(*) AS total FROM usage_logs'),
    pool.query<Record<string, unknown>>(
      `SELECT usage_logs.id AS id,
              usage_logs.ts AS ts,
              usage_logs.provider AS provider,
              usage_logs.model AS model,
              usage_logs.status AS status,
              usage_logs.latency_ms AS latencyMs,
              usage_logs.input_tokens AS inputTokens,
              usage_logs.output_tokens AS outputTokens,
              usage_logs.cache_create_tokens AS cacheCreateTokens,
              usage_logs.cache_read_tokens AS cacheReadTokens,
              usage_logs.cost AS cost,
              usage_logs.request_input AS requestInput,
              api_keys.name AS apiKeyName,
              accounts.name AS accountName
       FROM usage_logs
       LEFT JOIN api_keys ON api_keys.id = usage_logs.api_key_id
       LEFT JOIN accounts ON accounts.id = usage_logs.account_id
       ORDER BY usage_logs.ts DESC, usage_logs.id DESC
       LIMIT $1 OFFSET $2`,
      [safePageSize, offset],
    ),
  ])

  return {
    page: safePage,
    pageSize: safePageSize,
    total: toNum(totalRes.rows[0]?.total),
    logs: logsRes.rows.map(asDashboardRecentLog),
  }
}
