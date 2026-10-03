import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { pool } from '../db'
import { publicMediaError } from '../providers/publicIdentity'

const liveRequest = new AsyncLocalStorage<string>()
const LEASE_MS = 90_000
export const currentLiveRequestId = (): string | undefined => liveRequest.getStore()

/** Persist synchronous image requests before upstream generation starts. */
export async function withLiveImageRequest(
  input: { apiKeyId: string; userId: string | null; provider: string; model: string; requestedModel: string; requestInput: string },
  run: () => Promise<void>,
  statusCode: () => number,
): Promise<void> {
  const id = `image_${randomUUID()}`
  const started = Date.now()
  try {
    await pool.query(`INSERT INTO live_requests (id, api_key_id, user_id, provider, model, requested_model,
      request_input, created_at, lease_expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, input.apiKeyId, input.userId, input.provider, input.model, input.requestedModel, input.requestInput, started, started + LEASE_MS])
  } catch {
    console.error('[logs] failed to save image request start')
    return run()
  }
  // A lease makes interrupted requests visible as failures after a process crash.
  const timer = setInterval(() => {
    void pool.query('UPDATE live_requests SET lease_expires_at = $2 WHERE id = $1 AND finished_at IS NULL',
      [id, Date.now() + LEASE_MS]).catch(() => console.error('[logs] failed to renew image request lease'))
  }, 30_000)
  timer.unref()
  let failure: string | null = null
  try { await liveRequest.run(id, run) }
  catch (error) {
    failure = publicMediaError(error instanceof Error ? error.message : '生成请求中断')
    throw error
  } finally {
    clearInterval(timer)
    const httpStatus = failure ? 500 : statusCode()
    await pool.query(`UPDATE live_requests SET finished_at = $2, http_status = $3,
      status = CASE WHEN usage_log_id IS NULL THEN 'error' ELSE status END,
      error_code = CASE WHEN usage_log_id IS NULL THEN $4 ELSE error_code END,
      error_message = CASE WHEN usage_log_id IS NULL THEN $5 ELSE error_message END WHERE id = $1`,
    [id, Date.now(), httpStatus, failure ? 'request_interrupted' : httpStatus >= 400 ? `http_${httpStatus}` : 'usage_log_missing',
      failure ?? (httpStatus >= 400 ? `生成请求失败（HTTP ${httpStatus}）` : '请求已结束，用量记录未保存')])
      .catch(() => console.error('[logs] failed to save image request completion'))
  }
}
