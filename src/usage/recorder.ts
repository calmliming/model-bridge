import { randomBytes } from 'node:crypto'
import { db, sqlite } from '../db/index'
import { usageLogs } from '../db/schema'
import { estimateCost } from './pricing'
import type { UsageData } from '../providers/types'

const incrementKeyQuota = sqlite.prepare(
  'UPDATE api_keys SET quota_used = quota_used + ?, last_used_at = ? WHERE id = ?',
)

export interface UsageRecord {
  apiKeyId: string
  accountId: string
  provider: string
  model: string
  usage: UsageData
  status: string
  latencyMs: number
}

/** Writes one usage-log row and bumps the API key's quota_used. */
export function recordUsage(record: UsageRecord): void {
  const cost = estimateCost(record.provider, record.model, record.usage)
  try {
    db.insert(usageLogs)
      .values({
        id: randomBytes(12).toString('hex'),
        apiKeyId: record.apiKeyId,
        accountId: record.accountId,
        provider: record.provider,
        model: record.model || null,
        inputTokens: record.usage.inputTokens,
        outputTokens: record.usage.outputTokens,
        cacheCreateTokens: record.usage.cacheCreateTokens,
        cacheReadTokens: record.usage.cacheReadTokens,
        cost,
        status: record.status,
        latencyMs: record.latencyMs,
      })
      .run()
    if (record.apiKeyId && cost > 0) {
      incrementKeyQuota.run(cost, Date.now(), record.apiKeyId)
    }
  } catch (err) {
    // Usage logging must never break the relay response.
    console.error('[usage] failed to record usage:', (err as Error).message)
  }
}
