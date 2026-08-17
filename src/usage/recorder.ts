import { randomBytes } from 'node:crypto'
import type { PoolClient } from 'pg'
import { pool } from '../db/index'
import { estimateCost } from './pricing'
import type { UsageData } from '../providers/types'
import { debitWalletForUsage } from '../wallet/manager'
import { incrementSubscriptionUsage } from '../subscriptions/manager'

export interface UsageRecord {
  apiKeyId: string
  userId?: string | null
  accountId: string | null
  provider: string
  model: string
  requestInput?: string | null
  sessionKeyHash?: string | null
  sessionSource?: string | null
  usage: UsageData
  status: string
  latencyMs: number
  firstTokenMs?: number | null
  errorCode?: string | null
  /** Must already be redacted by the caller; recorder also bounds its length. */
  errorMessage?: string | null
  upstreamStatus?: number | null
  attemptCount?: number
  upstreamModel?: string | null
  modelMismatch?: boolean
  /** Group billing markup applied to the base list-price cost. Defaults to 1. */
  multiplier?: number
  /** Which budget this request bills to (decided at auth time). Defaults to balance. */
  billTo?: 'subscription' | 'balance'
  /** Subscription to charge when billTo === 'subscription'. */
  subscriptionId?: string | null
}

const pendingUsageWrites = new Set<Promise<boolean>>()

/**
 * Writes one usage-log row, bumps key quota, and charges the chosen budget.
 * Returns false when persistence failed; streaming callers can only log that
 * failure, while buffered relay paths may fail closed before sending upstream
 * success responses to clients.
 */
async function persistUsage(record: UsageRecord): Promise<boolean> {
  let client: PoolClient | null = null
  try {
    const baseCost = estimateCost(record.provider, record.model, record.usage)
    const multiplier =
      Number.isFinite(record.multiplier) && record.multiplier! > 0 ? record.multiplier! : 1
    const cost = Math.round(baseCost * multiplier * 1e6) / 1e6
    // Charge the subscription only when the gate selected it and a sub is present.
    const billTo: 'subscription' | 'balance' =
      record.billTo === 'subscription' && record.subscriptionId ? 'subscription' : 'balance'
    const id = randomBytes(12).toString('hex')
    const errorCode = record.errorCode?.trim().slice(0, 200) || null
    const errorMessage = record.errorMessage?.trim().slice(0, 2_000) || null
    const upstreamStatus = Number.isInteger(record.upstreamStatus) ? record.upstreamStatus! : null
    const attemptCount = Number.isFinite(record.attemptCount)
      ? Math.max(1, Math.trunc(record.attemptCount!))
      : 1
    const upstreamModel = record.upstreamModel?.trim().slice(0, 300) || null
    client = await pool.connect()
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO usage_logs
         (id, api_key_id, user_id, account_id, provider, model, request_input,
          session_key_hash, session_source,
           input_tokens, output_tokens, reasoning_tokens, cache_create_tokens, cache_read_tokens,
           image_input_tokens, image_output_tokens, image_count, image_size, image_model,
           cost, base_cost, bill_to, status, error_code, error_message, upstream_status,
           attempt_count, upstream_model, model_mismatch, latency_ms, first_token_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26,
               $27, $28, $29, $30, $31)`,
      [
        id,
        record.apiKeyId,
        record.userId ?? null,
        record.accountId,
        record.provider,
        record.model || null,
        record.requestInput ?? null,
        record.sessionKeyHash ?? null,
        record.sessionSource ?? null,
        record.usage.inputTokens,
        record.usage.outputTokens,
        record.usage.reasoningTokens,
        record.usage.cacheCreateTokens,
        record.usage.cacheReadTokens,
        record.usage.imageInputTokens ?? 0,
        record.usage.imageOutputTokens ?? 0,
        record.usage.imageCount ?? 0,
        record.usage.imageSize ?? null,
        record.usage.imageModel ?? null,
        cost,
        baseCost,
        billTo,
        record.status,
        errorCode,
        errorMessage,
        upstreamStatus,
        attemptCount,
        upstreamModel,
        record.modelMismatch === true,
        record.latencyMs,
        record.firstTokenMs ?? null,
      ],
    )
    if (record.apiKeyId && cost > 0) {
      await client.query(
        'UPDATE api_keys SET quota_used = quota_used + $1, last_used_at = $2 WHERE id = $3',
        [cost, Date.now(), record.apiKeyId],
      )
    }
    if (cost > 0) {
      if (billTo === 'subscription') {
        // Subscription pays: accrue the rolling windows, leave the wallet alone.
        await incrementSubscriptionUsage(client, record.subscriptionId!, cost)
      } else if (record.userId) {
        await debitWalletForUsage(client, record.userId, id, cost)
      }
    }
    await client.query('COMMIT')
    return true
  } catch (err) {
    await client?.query('ROLLBACK').catch(() => {})
    console.error('[usage] failed to record usage:', (err as Error).message)
    return false
  } finally {
    client?.release()
  }
}

export function recordUsage(record: UsageRecord): Promise<boolean> {
  const write = persistUsage(record)
  pendingUsageWrites.add(write)
  void write.then(
    () => pendingUsageWrites.delete(write),
    () => pendingUsageWrites.delete(write),
  )
  return write
}

/** Waits until every usage write started before or during the drain has settled. */
export async function waitForPendingUsage(): Promise<void> {
  while (pendingUsageWrites.size > 0) {
    await Promise.allSettled([...pendingUsageWrites])
  }
}
