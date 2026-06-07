import { pool } from '../db/index'
import { clearExpiredAccountCooldowns } from '../accounts/scheduler'
import { resolvePrice } from './pricing'

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

export interface DashboardRecentLog {
  id: string
  ts: number
  provider: string
  model: string | null
  status: string
  latencyMs: number | null
  firstTokenMs: number | null
  inputTokens: number
  outputTokens: number
  cacheCreateTokens: number
  cacheReadTokens: number
  cost: number
  baseCost: number
  billTo: string
  inputCost: number
  outputCost: number
  cacheCreateCost: number
  cacheReadCost: number
  inputPrice: number | null
  outputPrice: number | null
  cacheCreatePrice: number | null
  cacheReadPrice: number | null
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
    totalUsers: number
    activeUsers24h: number
    newUsers24h: number
    requestCount: number
    totalTokens: number
    totalCost: number
    requests24h: number
    tokens24h: number
    cost24h: number
    success24h: number
    avgLatencyMs24h: number
    rpm5m: number
    tpm5m: number
    tokens30d: number
    cost30d: number
  }
  daily: DailyStat[]
  byProvider: ProviderStat[]
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

function roundUsd(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

function asDashboardRecentLog(row: Record<string, unknown>): DashboardRecentLog {
  const provider = row.provider as string
  const model = (row.model as string | null) ?? null
  const price = resolvePrice(provider, model ?? '')
  const inputTokens = toNum(row.inputtokens)
  const outputTokens = toNum(row.outputtokens)
  const cacheCreateTokens = toNum(row.cachecreatetokens)
  const cacheReadTokens = toNum(row.cachereadtokens)
  const cost = toNum(row.cost)
  const rawBaseCost = toNum(row.basecost)
  const baseCost = rawBaseCost > 0 ? rawBaseCost : cost

  return {
    id: row.id as string,
    ts: toNum(row.ts),
    provider,
    model,
    status: row.status as string,
    latencyMs: row.latencyms == null ? null : toNum(row.latencyms),
    firstTokenMs: row.firsttokenms == null ? null : toNum(row.firsttokenms),
    inputTokens,
    outputTokens,
    cacheCreateTokens,
    cacheReadTokens,
    cost,
    baseCost,
    billTo: (row.billto as string | null) ?? 'balance',
    inputCost: price ? roundUsd((inputTokens * price.input) / 1_000_000) : 0,
    outputCost: price ? roundUsd((outputTokens * price.output) / 1_000_000) : 0,
    cacheCreateCost: price ? roundUsd((cacheCreateTokens * price.cacheWrite) / 1_000_000) : 0,
    cacheReadCost: price ? roundUsd((cacheReadTokens * price.cacheRead) / 1_000_000) : 0,
    inputPrice: price?.input ?? null,
    outputPrice: price?.output ?? null,
    cacheCreatePrice: price?.cacheWrite ?? null,
    cacheReadPrice: price?.cacheRead ?? null,
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
  await clearExpiredAccountCooldowns(now)
  const since24h = now - MS_PER_DAY
  const since5m = now - 5 * 60_000
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
       (SELECT COUNT(*) FROM users) AS totalUsers,
       (SELECT COUNT(DISTINCT user_id) FROM usage_logs WHERE ts >= $3 AND user_id IS NOT NULL) AS activeUsers24h,
       (SELECT COUNT(*) FROM users WHERE created_at >= $3) AS newUsers24h,
       (SELECT COUNT(*) FROM usage_logs) AS requestCount,
       (SELECT COALESCE(SUM(input_tokens + output_tokens + cache_create_tokens + cache_read_tokens), 0)
          FROM usage_logs) AS totalTokens,
       (SELECT COALESCE(SUM(cost), 0) FROM usage_logs) AS totalCost,
       (SELECT COUNT(*) FROM usage_logs WHERE ts >= $3) AS requests24h,
       (SELECT COALESCE(SUM(input_tokens + output_tokens + cache_create_tokens + cache_read_tokens), 0)
          FROM usage_logs WHERE ts >= $3) AS tokens24h,
       (SELECT COALESCE(SUM(cost), 0) FROM usage_logs WHERE ts >= $3) AS cost24h,
       (SELECT COUNT(*) FROM usage_logs WHERE ts >= $3 AND status = 'success') AS success24h,
       (SELECT COALESCE(AVG(latency_ms), 0)
          FROM usage_logs WHERE ts >= $3 AND latency_ms IS NOT NULL) AS avgLatencyMs24h,
       (SELECT COUNT(*) / 5.0 FROM usage_logs WHERE ts >= $4) AS rpm5m,
       (SELECT COALESCE(SUM(input_tokens + output_tokens + cache_create_tokens + cache_read_tokens), 0) / 5.0
          FROM usage_logs WHERE ts >= $4) AS tpm5m,
       (SELECT COALESCE(SUM(input_tokens + output_tokens + cache_create_tokens + cache_read_tokens), 0)
          FROM usage_logs WHERE ts >= $5) AS tokens30d,
       (SELECT COALESCE(SUM(cost), 0)
          FROM usage_logs WHERE ts >= $5) AS cost30d`,
    [now, now, since24h, since5m, since30d],
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
    totalUsers: toNum(t.totalusers),
    activeUsers24h: toNum(t.activeusers24h),
    newUsers24h: toNum(t.newusers24h),
    requestCount: toNum(t.requestcount),
    totalTokens: toNum(t.totaltokens),
    totalCost: toNum(t.totalcost),
    requests24h: toNum(t.requests24h),
    tokens24h: toNum(t.tokens24h),
    cost24h: toNum(t.cost24h),
    success24h: toNum(t.success24h),
    avgLatencyMs24h: Math.round(toNum(t.avglatencyms24h)),
    rpm5m: toNum(t.rpm5m),
    tpm5m: toNum(t.tpm5m),
    tokens30d: toNum(t.tokens30d),
    cost30d: toNum(t.cost30d),
  }

  const [daily, byProvider] = await Promise.all([
    dailyStats(14),
    statsByProvider(30),
  ])

  return { totals, daily, byProvider }
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
              usage_logs.first_token_ms AS firstTokenMs,
              usage_logs.input_tokens AS inputTokens,
              usage_logs.output_tokens AS outputTokens,
              usage_logs.cache_create_tokens AS cacheCreateTokens,
              usage_logs.cache_read_tokens AS cacheReadTokens,
              usage_logs.cost AS cost,
              usage_logs.base_cost AS baseCost,
              usage_logs.bill_to AS billTo,
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
