import { pool } from '../db'
import { getSetting, setSetting } from '../db/settings'
import { z } from 'zod'

export const healthSettingsSchema = z.object({
  minSamples: z.number().int().min(5).max(10000),
  errorRatePercent: z.number().min(1).max(100),
  ttftP95Ms: z.number().int().min(100).max(600000),
})
export type HealthSettings = z.infer<typeof healthSettingsSchema>
export const DEFAULT_HEALTH_SETTINGS: HealthSettings = { minSamples: 20, errorRatePercent: 10, ttftP95Ms: 10000 }
export async function getHealthSettings(): Promise<HealthSettings> {
  try { return healthSettingsSchema.parse(JSON.parse(await getSetting('channel_health_thresholds') ?? 'null')) }
  catch { return { ...DEFAULT_HEALTH_SETTINGS } }
}
export async function saveHealthSettings(value: HealthSettings) {
  await setSetting('channel_health_thresholds', JSON.stringify(healthSettingsSchema.parse(value)))
}
export const healthQuerySchema = z.object({
  hours: z.coerce.number().int().min(1).max(168).default(24),
  groupBy: z.enum(['provider', 'account', 'model']).default('account'),
  provider: z.string().regex(/^[a-z0-9-]{1,30}$/).optional(),
  groupId: z.string().trim().min(1).max(100).optional(),
})
export type HealthQuery = z.infer<typeof healthQuerySchema>
const CATEGORY_SQL = `CASE
  WHEN error_code = 'client_disconnected' THEN 'canceled'
  WHEN COALESCE(error_code, '') LIKE 'gemini_policy_%'
    OR COALESCE(error_code, '') ~* '(cyber_policy|content_policy|content_filter|safety)' THEN 'policy'
  WHEN status = 'success' THEN 'success'
  WHEN upstream_status IN (400, 404, 422) OR error_code IN ('gemini_upstream_INVALID_ARGUMENT', 'gemini_upstream_NOT_FOUND', 'gemini_upstream_400', 'gemini_upstream_404', 'gemini_upstream_422') THEN 'request'
  ELSE 'upstream' END`

export interface HealthRow {
  id: string; label: string; provider: string; requests: number; eligible: number; success: number; failures: number
  excluded: number; canceled: number; policy: number; requestErrors: number; tokens: number
  errorRatePercent: number | null; ttftSamples: number; ttftP95Ms: number | null; latencyP95Ms: number | null
  state: 'healthy' | 'warning' | 'insufficient'; alerts: string[]
}
export function healthRow(row: Record<string, unknown>, settings: HealthSettings): HealthRow {
  const n = (key: string) => Number(row[key] ?? 0)
  const eligible = n('eligible'), failures = n('failures'), ttftSamples = n('ttft_samples')
  const errorRatePercent = eligible ? failures / eligible * 100 : null
  const ttftP95Ms = row.ttft_p95 == null ? null : Math.round(n('ttft_p95'))
  const alerts: string[] = []
  if (eligible >= settings.minSamples) {
    if (errorRatePercent! >= settings.errorRatePercent) alerts.push('上游错误率超阈值')
    if (ttftSamples >= settings.minSamples && ttftP95Ms != null && ttftP95Ms >= settings.ttftP95Ms) alerts.push('首 Token P95 超阈值')
  }
  return { id: String(row.id), label: String(row.label ?? row.id), provider: String(row.provider),
    requests: n('requests'), eligible, success: n('success'), failures,
    canceled: n('canceled'), policy: n('policy'), requestErrors: n('request_errors'),
    excluded: n('requests') - eligible, tokens: n('tokens'), errorRatePercent, ttftSamples, ttftP95Ms,
    latencyP95Ms: row.latency_p95 == null ? null : Math.round(n('latency_p95')),
    state: eligible < settings.minSamples ? 'insufficient' : alerts.length ? 'warning' : 'healthy', alerts }
}

export async function channelHealth(query: HealthQuery, now = Date.now()) {
  const settings = await getHealthSettings()
  const from = now - query.hours * 3600_000
  const base = `WITH observed AS (
    SELECT l.*, ${CATEGORY_SQL} AS category FROM usage_logs l
    WHERE ts >= $1 AND ts < $2 AND account_id IS NOT NULL
      AND ($3::text IS NULL OR provider = $3)
      AND ($4::text IS NULL OR EXISTS (SELECT 1 FROM account_group_members m WHERE m.account_id = l.account_id AND m.group_id = $4))
  )`
  // groupBy is a closed enum, never an arbitrary SQL identifier.
  const group = query.groupBy === 'provider' ? 'o.provider' : query.groupBy === 'model' ? "o.provider || ':' || COALESCE(o.model, 'unknown')" : 'o.account_id'
  const label = query.groupBy === 'account' ? 'COALESCE(MAX(a.name), o.account_id)' : query.groupBy === 'model' ? "COALESCE(MAX(o.model), 'unknown')" : 'o.provider'
  const args = [from, now, query.provider ?? null, query.groupId ?? null]
  const [grouped, trend] = await Promise.all([
    pool.query(`${base} SELECT ${group} AS id, ${label} AS label, o.provider,
      COUNT(*) AS requests,
      COUNT(*) FILTER (WHERE category IN ('success', 'upstream')) AS eligible,
      COUNT(*) FILTER (WHERE category = 'success') AS success,
      COUNT(*) FILTER (WHERE category = 'upstream') AS failures,
      COUNT(*) FILTER (WHERE category = 'canceled') AS canceled,
      COUNT(*) FILTER (WHERE category = 'policy') AS policy,
      COUNT(*) FILTER (WHERE category = 'request') AS request_errors,
      COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_create_tokens), 0) AS tokens,
      COUNT(first_token_ms) FILTER (WHERE category = 'success' AND first_token_ms >= 0) AS ttft_samples,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY first_token_ms) FILTER (WHERE category = 'success' AND first_token_ms >= 0) AS ttft_p95,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE category = 'success' AND latency_ms >= 0) AS latency_p95
      FROM observed o LEFT JOIN accounts a ON a.id = o.account_id
      GROUP BY ${group}, o.provider ORDER BY failures DESC, requests DESC, id LIMIT 501`, args),
    pool.query(`${base} SELECT floor(ts / 3600000.0) * 3600000 AS bucket,
      COUNT(*) AS requests, COUNT(*) FILTER (WHERE category = 'success') AS success,
      COUNT(*) FILTER (WHERE category = 'upstream') AS failures,
      COUNT(*) FILTER (WHERE category NOT IN ('success', 'upstream')) AS excluded
      FROM observed GROUP BY bucket ORDER BY bucket`, args),
  ])
  const rows = grouped.rows.slice(0, 500).map(row => healthRow(row, settings))
  return { from, to: now, hours: query.hours, groupBy: query.groupBy, settings, rows, truncated: grouped.rows.length > 500,
    alerts: rows.filter(row => row.state === 'warning').map(row => ({ id: row.id, label: row.label, reasons: row.alerts })),
    trend: trend.rows.map(row => ({ at: Number(row.bucket), requests: Number(row.requests), success: Number(row.success), failures: Number(row.failures), excluded: Number(row.excluded) })) }
}
