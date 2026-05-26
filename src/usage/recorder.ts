import { randomBytes } from 'node:crypto'
import { db, pool } from '../db/index'
import { usageLogs } from '../db/schema'
import { estimateCost } from './pricing'
import type { UsageData } from '../providers/types'

export interface UsageRecord {
  apiKeyId: string
  accountId: string
  provider: string
  model: string
  requestInput?: string | null
  usage: UsageData
  status: string
  latencyMs: number
}

/** Writes one usage-log row and bumps the API key's quota_used. */
export async function recordUsage(record: UsageRecord): Promise<void> {
  const cost = estimateCost(record.provider, record.model, record.usage)
  try {
    await db.insert(usageLogs).values({
      id: randomBytes(12).toString('hex'),
      apiKeyId: record.apiKeyId,
      accountId: record.accountId,
      provider: record.provider,
      model: record.model || null,
      requestInput: record.requestInput ?? null,
      inputTokens: record.usage.inputTokens,
      outputTokens: record.usage.outputTokens,
      cacheCreateTokens: record.usage.cacheCreateTokens,
      cacheReadTokens: record.usage.cacheReadTokens,
      cost,
      status: record.status,
      latencyMs: record.latencyMs,
    })
    if (record.apiKeyId && cost > 0) {
      await pool.query(
        'UPDATE api_keys SET quota_used = quota_used + $1, last_used_at = $2 WHERE id = $3',
        [cost, Date.now(), record.apiKeyId],
      )
    }
  } catch (err) {
    // Usage logging must never break the relay response.
    console.error('[usage] failed to record usage:', (err as Error).message)
  }
}
