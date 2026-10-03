import { pool } from '../db'
import { publicMediaError } from '../providers/publicIdentity'
import { MODEL_MANUFACTURERS, modelManufacturerSql } from './manufacturers'

export interface RequestLogFilters {
  id?: string
  manufacturer?: string
  kind?: 'text' | 'image' | 'video'
  status?: 'running' | 'settling' | 'success' | 'error'
  model?: string
  key?: string
  startDate?: number
  endDate?: number
}

interface LogUsage {
  latency_ms?: number | null; subscription_points?: number | null; bill_to?: string | null
  input_tokens?: number; output_tokens?: number; cache_create_tokens?: number; cache_read_tokens?: number
  image_input_tokens?: number; image_output_tokens?: number; image_cache_read_tokens?: number; image_count?: number
  video_seconds?: number; video_resolution?: string | null
}
interface LogRow {
  id: string; task_id: string | null; created_at: number; updated_at: number
  manufacturer: string; model: string | null; requested_model: string | null
  kind: 'text' | 'image' | 'video'; status: 'running' | 'settling' | 'success' | 'error'
  task_status: string | null; progress: number | null; key_name: string | null
  cost: number | null; usage: LogUsage | null; request_input: string | null
  error_code: string | null; error_message: string | null; results: Array<{ url: string }>
  provider: string; account_name: string | null; user_name: string | null; upstream_request_id: string | null
}

// Same deterministic ID as recordUsage({ idempotencyKey: `grsai-task:${id}` }).
const taskUsageId = (task: string) => `substr(encode(sha256(convert_to('grsai-task:' || ${task}.id, 'UTF8')), 'hex'), 1, 24)`

export async function listRequestLogs(page = 1, pageSize = 20, filters: RequestLogFilters = {}, userId?: string) {
  const values: unknown[] = [Date.now()]
  const param = (value: unknown) => { values.push(value); return `$${values.length}` }
  const owner = userId == null ? null : param(userId)
  const scope = (alias: string) => owner ? `AND ${alias}.user_id = ${owner}` : ''
  // Each request appears once throughout submission, generation and settlement.
  // An active request never creates a billable usage_logs row.
  const source = `WITH requests AS (
    SELECT 'usage:' || u.id AS id, u.user_id, u.api_key_id, u.account_id, u.provider, COALESCE(NULLIF(u.upstream_model, ''), u.model) AS model,
      u.model AS requested_model, COALESCE(NULLIF(u.upstream_model, ''), NULLIF(u.image_model, ''), u.model, '') AS manufacturer_model,
      CASE WHEN u.video_seconds > 0 OR COALESCE(NULLIF(u.image_model, ''), NULLIF(u.upstream_model, ''), u.model) ~* '(minimax-h3|sora|veo|hailuo|cogvideo|wan[.-])' THEN 'video'
        WHEN u.image_count > 0 OR u.image_output_tokens > 0 OR COALESCE(NULLIF(u.image_model, ''), NULLIF(u.upstream_model, ''), u.model) ~* '(gpt-image|dall-e|imagen|cogview)' THEN 'image' ELSE 'text' END AS kind,
      u.status, NULL::text AS task_status, NULL::float8 AS progress, u.ts AS created_at, u.ts AS updated_at,
      u.cost, to_jsonb(u) AS usage, u.request_input, u.error_code, u.error_message, u.upstream_request_id,
      NULL::text AS task_id, '[]'::jsonb AS results
    FROM usage_logs u WHERE TRUE ${scope('u')}
      AND NOT EXISTS (SELECT 1 FROM media_tasks t WHERE u.id = ${taskUsageId('t')})
      AND NOT EXISTS (SELECT 1 FROM live_requests r WHERE r.usage_log_id = u.id)
    UNION ALL
    SELECT t.id, t.user_id, t.api_key_id, t.account_id, 'grsai', t.model, t.requested_model, t.model, t.kind,
      CASE WHEN t.status IN ('submitting', 'running') THEN 'running'
        WHEN t.status = 'succeeded' AND NOT t.settled THEN 'settling'
        WHEN t.status = 'succeeded' THEN 'success' ELSE 'error' END,
      t.status, t.progress, t.created_at, t.updated_at, u.cost,
      COALESCE(to_jsonb(u), '{}'::jsonb) || jsonb_build_object('video_seconds', COALESCE(NULLIF(u.video_seconds, 0), (t.request_params->>'duration')::float8, 0),
        'video_resolution', COALESCE(u.video_resolution, t.request_params->>'resolution')),
      t.request_input, COALESCE(u.error_code, CASE WHEN t.status IN ('failed', 'violation') THEN t.status END),
      COALESCE(u.error_message, t.error), t.upstream_id, t.id,
      CASE WHEN t.settled THEN t.results ELSE '[]'::jsonb END
    FROM media_tasks t LEFT JOIN usage_logs u ON u.id = ${taskUsageId('t')} WHERE TRUE ${scope('t')}
    UNION ALL
    SELECT r.id, r.user_id, r.api_key_id, u.account_id, r.provider, r.model, r.requested_model,
      COALESCE(NULLIF(u.upstream_model, ''), r.model), 'image',
      CASE WHEN r.finished_at IS NULL AND r.usage_log_id IS NULL AND r.lease_expires_at < $1 THEN 'error' ELSE r.status END,
      NULL::text, NULL::float8, r.created_at, COALESCE(r.finished_at, LEAST(r.lease_expires_at, $1)), u.cost, to_jsonb(u), r.request_input,
      CASE WHEN r.finished_at IS NULL AND r.usage_log_id IS NULL AND r.lease_expires_at < $1 THEN 'request_interrupted' ELSE r.error_code END,
      CASE WHEN r.finished_at IS NULL AND r.usage_log_id IS NULL AND r.lease_expires_at < $1 THEN '生成进程中断，未收到完成结果' ELSE r.error_message END,
      u.upstream_request_id, NULL::text, '[]'::jsonb
    FROM live_requests r LEFT JOIN usage_logs u ON u.id = r.usage_log_id WHERE TRUE ${scope('r')}
  ), classified AS (
    SELECT requests.*, ${modelManufacturerSql('manufacturer_model', 'provider')} AS manufacturer FROM requests
  ), named AS (
    SELECT c.*, k.name AS key_name, k.key_prefix, a.name AS account_name, usr.name AS user_name
    FROM classified c LEFT JOIN api_keys k ON k.id = c.api_key_id
    LEFT JOIN accounts a ON a.id = c.account_id LEFT JOIN users usr ON usr.id = c.user_id
  )`
  const where: string[] = []
  if (filters.id) where.push(`id = ${param(filters.id)}`)
  if (filters.manufacturer) where.push(`manufacturer = ${param(filters.manufacturer)}`)
  if (filters.kind) where.push(`kind = ${param(filters.kind)}`)
  if (filters.status) where.push(`status = ${param(filters.status)}`)
  if (filters.model) {
    const value = param(`%${filters.model}%`)
    where.push(`(model ILIKE ${value} OR requested_model ILIKE ${value})`)
  }
  if (filters.key) {
    const value = param(`%${filters.key}%`)
    where.push(`(key_name ILIKE ${value} OR key_prefix ILIKE ${value} OR api_key_id ILIKE ${value})`)
  }
  if (filters.startDate != null) where.push(`created_at >= ${param(filters.startDate)}`)
  if (filters.endDate != null) where.push(`created_at <= ${param(filters.endDate)}`)
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const limit = Math.max(1, Math.min(100, Math.trunc(pageSize)))
  const currentPage = Math.max(1, Math.trunc(page))
  // Count and rows use one statement/snapshot even while a task is settling.
  const result = await pool.query<{ total: string; logs: LogRow[] }>(`${source}, filtered AS NOT MATERIALIZED (SELECT * FROM named ${clause}),
    paged AS (SELECT * FROM filtered ORDER BY created_at DESC, id DESC LIMIT ${param(limit)} OFFSET ${param((currentPage - 1) * limit)})
    SELECT (SELECT COUNT(*) FROM filtered) AS total,
      COALESCE((SELECT jsonb_agg(to_jsonb(paged) ORDER BY created_at DESC, id DESC) FROM paged), '[]'::jsonb) AS logs`, values)
  const rows = result.rows[0]
  const logs = (rows?.logs ?? []).map(row => {
    const usage = row.usage ?? {}
    const latencyMs = usage.latency_ms ?? Math.max(0, Number(row.updated_at) - Number(row.created_at))
    return {
      id: row.id, taskId: row.task_id, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
      manufacturer: row.manufacturer, model: row.model, requestedModel: row.requested_model,
      kind: row.kind, status: row.status, taskStatus: row.task_status, progress: row.progress,
      apiKeyName: row.key_name, latencyMs: Number(latencyMs), cost: row.cost == null ? null : Number(row.cost),
      subscriptionPoints: usage.subscription_points ?? null, billTo: usage.bill_to ?? null,
      inputTokens: Number(usage.input_tokens ?? 0) + Number(usage.image_input_tokens ?? 0),
      outputTokens: Number(usage.output_tokens ?? 0) + Number(usage.image_output_tokens ?? 0),
      cacheTokens: Number(usage.cache_create_tokens ?? 0) + Number(usage.cache_read_tokens ?? 0) + Number(usage.image_cache_read_tokens ?? 0),
      imageCount: Number(usage.image_count ?? 0), videoSeconds: Number(usage.video_seconds ?? 0), videoResolution: usage.video_resolution ?? null,
      requestInput: row.request_input, errorCode: row.error_code,
      errorMessage: row.error_message ? publicMediaError(row.error_message) : null,
      results: row.results,
      ...(userId == null ? { provider: row.provider, accountName: row.account_name, userName: row.user_name,
        upstreamRequestId: row.upstream_request_id } : {}),
    }
  })
  return { page: currentPage, pageSize: limit, total: Number(rows?.total ?? 0), logs,
    manufacturers: MODEL_MANUFACTURERS.map(({ id, label }) => ({ value: id, label })) }
}
