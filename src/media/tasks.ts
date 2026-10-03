import { randomUUID } from 'node:crypto'
import { pool } from '../db'
import { getAccount, ensureFreshToken } from '../accounts/manager'
import { markAccountUsed } from '../accounts/scheduler'
import type { AuthedApiKey } from '../middleware/apiKeyAuth'
import { emptyUsage, type UsageData } from '../providers/types'
import { generateGrsai, grsaiBaseUrl, queryGrsaiResult, type GrsaiGenerateRequest, type GrsaiResult } from '../providers/grsai/client'
import { calculateUsageCost, resolvePrice, type TierPrice } from '../usage/pricing'
import { recordUsage } from '../usage/recorder'
import { usdToMicros } from '../wallet/money'
import { redactUpstreamError } from '../http/upstreamDiagnostics'
import { publicMediaError } from '../providers/publicIdentity'

export class MediaTaskError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message) }
}
interface BillingSnapshot {
  multiplier: number; billTo: 'subscription' | 'balance'; subscriptionId: string | null
  subscriptionQuotaMode?: 'spend' | 'usage'; price: TierPrice
}
export interface MediaTask {
  id: string; upstream_id: string | null; api_key_id: string; user_id: string; account_id: string
  base_url: string; model: string; requested_model: string; kind: 'image' | 'video'
  status: 'submitting' | GrsaiResult['status']; progress: number; results: Array<{ url: string }>; error: string | null
  request_input: string; request_params: Pick<GrsaiGenerateRequest, 'duration' | 'resolution' | 'aspectRatio'>
  billing: BillingSnapshot; estimated_micros: number; settled: boolean; created_at: number; updated_at: number
}

export function mediaTaskUsage(task: MediaTask): UsageData {
  if (task.status !== 'succeeded') return { ...emptyUsage(), usageSource: 'missing' }
  return { ...emptyUsage(), usageSource: 'upstream', ...(task.kind === 'video'
    ? { videoSeconds: task.request_params.duration, videoResolution: task.request_params.resolution }
    : { imageCount: task.results.length, imageModel: task.model, imageSize: task.request_params.aspectRatio }) }
}

/** Do not expose upstream account IDs, credentials, billing or another owner's task. */
export function publicMediaTask(task: MediaTask) {
  const ready = task.settled || task.status === 'running' || task.status === 'submitting'
  return { id: task.id, object: task.kind, model: task.requested_model,
    status: ready && task.status !== 'submitting' ? task.status : 'running',
    progress: ready ? task.progress : Math.min(99, task.progress),
    results: ready ? task.results : [], ...(ready && task.error ? { error: publicMediaError(task.error) } : {}),
    ...task.request_params, created_at: Math.floor(task.created_at / 1000) }
}

async function storeResult(task: MediaTask, result: GrsaiResult): Promise<MediaTask> {
  const { rows } = await pool.query<MediaTask>(`UPDATE media_tasks SET upstream_id = $2, status = $3, progress = $4,
    results = $5, error = $6, updated_at = $7, next_poll_at = $8 WHERE id = $1 RETURNING *`,
  [task.id, result.id, result.status, result.progress, JSON.stringify(result.results), result.error ?? null, Date.now(), Date.now() + 5_000])
  return rows[0]!
}

async function settleTask(task: MediaTask): Promise<MediaTask> {
  if (task.settled || ['submitting', 'running'].includes(task.status)) return task
  const recorded = await recordUsage({ apiKeyId: task.api_key_id, userId: task.user_id, accountId: task.account_id,
    provider: 'grsai', model: task.model, upstreamModel: task.model, upstreamRequestId: task.upstream_id,
    requestInput: task.request_input, usage: mediaTaskUsage(task), status: task.status === 'succeeded' ? 'success' : 'error',
    errorCode: task.status === 'succeeded' ? null : task.status, errorMessage: task.error,
    latencyMs: task.updated_at - task.created_at, requestStartedAt: task.created_at,
    idempotencyKey: `grsai-task:${task.id}`, priceSnapshot: task.billing.price,
    multiplier: task.billing.multiplier, billTo: task.billing.billTo, subscriptionId: task.billing.subscriptionId,
    subscriptionQuotaMode: task.billing.subscriptionQuotaMode,
  })
  if (!recorded) throw new MediaTaskError(503, '任务已完成，但用量结算暂未成功；请稍后查询同一任务')
  await pool.query('UPDATE media_tasks SET settled = TRUE, polling_until = 0 WHERE id = $1', [task.id])
  return { ...task, settled: true }
}

type SelectedAccount = NonNullable<Awaited<ReturnType<typeof import('../accounts/scheduler').pickAccount>>>

/** Reserve persistent capacity and wallet headroom before creating a paid task. */
async function admitTask(key: AuthedApiKey, account: SelectedAccount, body: GrsaiGenerateRequest, requestedModel: string): Promise<MediaTask> {
  const price = resolvePrice('grsai', body.model)
  if (!price) throw new MediaTaskError(400, '模型没有可用的计费配置')
  const usage: UsageData = { ...emptyUsage(), ...(body.model === 'minimax-h3'
    ? { videoSeconds: body.duration, videoResolution: body.resolution } : { imageCount: 1 }) }
  const estimated = usdToMicros(calculateUsageCost('grsai', body.model, usage, Date.now(), price) * key.groupMultiplier)
  const billing: BillingSnapshot = { multiplier: key.groupMultiplier, billTo: key.billTo,
    subscriptionId: key.subscriptionId, subscriptionQuotaMode: key.subscriptionQuotaMode, price }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Every replica uses the same lock order. Submitting and unsettled tasks keep
    // their slots and reservation across process restarts and failed polling.
    for (const lock of [`media-user:${key.userId}`, `media-account:${account.id}`]) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lock])
    }
    const active = await client.query(`SELECT
      COUNT(*) FILTER (WHERE api_key_id = $1) AS key_count,
      COUNT(*) FILTER (WHERE user_id = $2) AS user_count,
      COUNT(*) FILTER (WHERE account_id = $3) AS account_count,
      COALESCE(SUM(estimated_micros) FILTER (WHERE api_key_id = $1), 0) AS key_reserved,
      COALESCE(SUM(estimated_micros) FILTER (WHERE user_id = $2 AND billing->>'billTo' = 'balance'), 0) AS reserved
      FROM media_tasks WHERE settled = FALSE AND (user_id = $2 OR account_id = $3)`, [key.id, key.userId, account.id])
    const count = active.rows[0]
    const quota = await client.query('SELECT quota_limit, quota_used FROM api_keys WHERE id = $1', [key.id])
    const budget = quota.rows[0]
    if (budget?.quota_limit != null && Number(budget.quota_used) + (Number(count.key_reserved) + estimated) / 1e6 > Number(budget.quota_limit)) {
      throw new MediaTaskError(429, '本次生成和正在执行的任务将超过 API Key 成本配额')
    }
    for (const [limit, value] of [[key.concurrencyLimit, count.key_count], [key.userConcurrencyLimit, count.user_count], [account.concurrencyLimit, count.account_count]]) {
      if (limit != null && Number(value) >= Number(limit)) throw new MediaTaskError(429, '生成任务并发已达到上限，请等待现有任务完成')
    }
    if (key.billTo === 'balance') {
      const wallet = await client.query('SELECT balance_micros FROM users WHERE id = $1 FOR UPDATE', [key.userId])
      if (!wallet.rows.length || Number(wallet.rows[0].balance_micros) - Number(count.reserved) < estimated) {
        throw new MediaTaskError(402, '余额不足以支付本次生成和正在执行的任务')
      }
    }
    const now = Date.now()
    const params = { ...(body.duration != null ? { duration: body.duration } : {}),
      ...(body.resolution ? { resolution: body.resolution } : {}), ...(body.aspectRatio ? { aspectRatio: body.aspectRatio } : {}) }
    const { rows } = await client.query<MediaTask>(`INSERT INTO media_tasks
      (id, api_key_id, user_id, account_id, base_url, model, requested_model, kind, status, request_input,
       request_params, billing, estimated_micros, next_poll_at, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'submitting',$9,$10,$11,$12,$13,$13,$13) RETURNING *`,
    [`media_${randomUUID()}`, key.id, key.userId, account.id, grsaiBaseUrl(account.proxyUrl), body.model, requestedModel,
      body.model === 'minimax-h3' ? 'video' : 'image', body.prompt.slice(0, 500), JSON.stringify(params), JSON.stringify(billing), estimated, now])
    await client.query('COMMIT')
    return rows[0]!
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error }
  finally { client.release() }
}

export async function createMediaTask(key: AuthedApiKey, account: SelectedAccount, body: GrsaiGenerateRequest, requestedModel: string): Promise<MediaTask> {
  let task = await admitTask(key, account, body, requestedModel)
  let accepted: GrsaiResult | null = null
  try {
    const token = await ensureFreshToken(account)
    // Never retry task creation: a timeout may have occurred after acceptance.
    accepted = await generateGrsai(token, { ...body, replyType: 'async' }, task.base_url)
    task = await storeResult(task, accepted)
    await markAccountUsed(account.id)
  } catch (error) {
    // An accepted task whose persistence failed must not be overwritten or
    // re-submitted. The caller receives its local ID for subsequent recovery.
    if (accepted) {
      try { task = await storeResult(task, accepted) }
      catch { throw new MediaTaskError(503, `任务 ${task.id} 已提交，暂未保存结果；请联系管理员核对，避免重复提交`) }
    } else {
      const message = redactUpstreamError(error instanceof Error ? error.message : 'GrsAI task submission failed')
      const { rows } = await pool.query<MediaTask>(`UPDATE media_tasks SET status = 'failed', error = $2, updated_at = $3
        WHERE id = $1 RETURNING *`, [task.id, message, Date.now()])
      task = rows[0]!
    }
  }
  return settleTask(task)
}

export async function getMediaTask(id: string, apiKeyId?: string): Promise<MediaTask | null> {
  const { rows } = await pool.query<MediaTask>('SELECT * FROM media_tasks WHERE id = $1 AND ($2::text IS NULL OR api_key_id = $2)', [id, apiKeyId ?? null])
  return rows[0] ?? null
}

/** Atomic polling lease plus idempotent settlement cover concurrent GETs/replicas. */
export async function refreshMediaTask(task: MediaTask): Promise<MediaTask> {
  if (task.settled) return task
  const { rows } = await pool.query<MediaTask>(`UPDATE media_tasks SET polling_until = $2
    WHERE id = $1 AND settled = FALSE AND polling_until < $3 AND next_poll_at <= $3 RETURNING *`, [task.id, Date.now() + 60_000, Date.now()])
  if (!rows.length) return (await getMediaTask(task.id)) ?? task
  task = rows[0]!
  let retryDelay = 5_000
  try {
    if (task.status === 'submitting') {
      if (Date.now() - task.created_at < 120_000) return task
      // No upstream ID survived. Fail without billing or blindly issuing a
      // second generation; the supplier log can be used for manual recovery.
      const { rows } = await pool.query<MediaTask>(`UPDATE media_tasks SET status = 'failed', error = $2, updated_at = $3
        WHERE id = $1 RETURNING *`, [task.id, '提交中断，未保存上游任务 ID；请核对供应商日志后重新提交', Date.now()])
      task = rows[0]!
    } else if (task.status === 'running') {
      if (Date.now() - task.created_at > 24 * 60 * 60_000) {
        const { rows } = await pool.query<MediaTask>(`UPDATE media_tasks SET status = 'failed', error = $2, updated_at = $3
          WHERE id = $1 RETURNING *`, [task.id, '任务超过 24 小时仍未完成，请核对供应商日志', Date.now()])
        return await settleTask(rows[0]!)
      }
      const account = await getAccount(task.account_id)
      if (!account || account.provider !== 'grsai' || grsaiBaseUrl(account.proxyUrl) !== task.base_url) {
        throw new MediaTaskError(503, '生成服务暂不可用，请联系管理员后查询同一任务')
      }
      task = await storeResult(task, await queryGrsaiResult(await ensureFreshToken(account), task.upstream_id!, task.base_url))
    }
    return await settleTask(task)
  } catch (error) {
    retryDelay = 30_000
    throw error
  } finally {
    await pool.query('UPDATE media_tasks SET polling_until = 0, next_poll_at = $2 WHERE id = $1', [task.id, Date.now() + retryDelay])
  }
}

export function startMediaTaskJob(): () => Promise<void> {
  let running: Promise<void> | null = null
  let stopping = false
  const timer = setInterval(() => {
    if (running) return
    running = (async () => {
      const { rows } = await pool.query<MediaTask>(`SELECT * FROM media_tasks WHERE settled = FALSE AND next_poll_at <= $1
        AND polling_until < $1 ORDER BY next_poll_at LIMIT 10`, [Date.now()])
      for (const task of rows) {
        if (stopping) break
        await refreshMediaTask(task).catch(() => console.error(`[media] task ${task.id} polling/settlement deferred`))
      }
    })().catch(() => console.error('[media] task sweep failed')).finally(() => { running = null })
  }, 5_000)
  timer.unref()
  return async () => { stopping = true; clearInterval(timer); await running }
}
