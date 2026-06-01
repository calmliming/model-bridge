import { randomBytes } from 'node:crypto'
import { pool } from '../db/index'
import { estimateCost } from './pricing'
import type { UsageData } from '../providers/types'
import { debitWalletForUsage } from '../wallet/manager'

export interface UsageRecord {
  apiKeyId: string
  userId?: string | null
  accountId: string
  provider: string
  model: string
  requestInput?: string | null
  usage: UsageData
  status: string
  latencyMs: number
}

/** Writes one usage-log row, bumps key quota, and debits the owning user wallet. */
export async function recordUsage(record: UsageRecord): Promise<void> {
  const cost = estimateCost(record.provider, record.model, record.usage)
  const id = randomBytes(12).toString('hex')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO usage_logs
         (id, api_key_id, user_id, account_id, provider, model, request_input,
          input_tokens, output_tokens, cache_create_tokens, cache_read_tokens,
          cost, status, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        id,
        record.apiKeyId,
        record.userId ?? null,
        record.accountId,
        record.provider,
        record.model || null,
        record.requestInput ?? null,
        record.usage.inputTokens,
        record.usage.outputTokens,
        record.usage.cacheCreateTokens,
        record.usage.cacheReadTokens,
        cost,
        record.status,
        record.latencyMs,
      ],
    )
    if (record.apiKeyId && cost > 0) {
      await client.query(
        'UPDATE api_keys SET quota_used = quota_used + $1, last_used_at = $2 WHERE id = $3',
        [cost, Date.now(), record.apiKeyId],
      )
    }
    if (record.userId) {
      await debitWalletForUsage(client, record.userId, id, cost)
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    // Usage logging must never break the relay response.
    console.error('[usage] failed to record usage:', (err as Error).message)
  } finally {
    client.release()
  }
}
