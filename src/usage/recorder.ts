import { randomBytes } from 'node:crypto'
import { pool } from '../db/index'
import { estimateCost } from './pricing'
import type { UsageData } from '../providers/types'
import { debitWalletForUsage } from '../wallet/manager'
import { incrementSubscriptionUsage } from '../subscriptions/manager'

export interface UsageRecord {
  apiKeyId: string
  userId?: string | null
  accountId: string
  provider: string
  model: string
  requestInput?: string | null
  sessionKeyHash?: string | null
  sessionSource?: string | null
  usage: UsageData
  status: string
  latencyMs: number
  firstTokenMs?: number | null
  /** Group billing markup applied to the base list-price cost. Defaults to 1. */
  multiplier?: number
  /** Which budget this request bills to (decided at auth time). Defaults to balance. */
  billTo?: 'subscription' | 'balance'
  /** Subscription to charge when billTo === 'subscription'. */
  subscriptionId?: string | null
}

/**
 * Writes one usage-log row, bumps key quota, and charges the chosen budget.
 * Returns false when persistence failed; streaming callers can only log that
 * failure, while buffered relay paths may fail closed before sending upstream
 * success responses to clients.
 */
export async function recordUsage(record: UsageRecord): Promise<boolean> {
  const baseCost = estimateCost(record.provider, record.model, record.usage)
  const multiplier = Number.isFinite(record.multiplier) && record.multiplier! > 0 ? record.multiplier! : 1
  const cost = Math.round(baseCost * multiplier * 1e6) / 1e6
  // Charge the subscription only when the gate selected it and a sub is present.
  const billTo: 'subscription' | 'balance' =
    record.billTo === 'subscription' && record.subscriptionId ? 'subscription' : 'balance'
  const id = randomBytes(12).toString('hex')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO usage_logs
         (id, api_key_id, user_id, account_id, provider, model, request_input,
          session_key_hash, session_source,
          input_tokens, output_tokens, reasoning_tokens, cache_create_tokens, cache_read_tokens,
          cost, base_cost, bill_to, status, latency_ms, first_token_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
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
        cost,
        baseCost,
        billTo,
        record.status,
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
    await client.query('ROLLBACK').catch(() => {})
    console.error('[usage] failed to record usage:', (err as Error).message)
    return false
  } finally {
    client.release()
  }
}
