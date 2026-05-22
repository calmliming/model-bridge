import { randomBytes } from 'node:crypto'
import { db } from '../db/index'
import { usageLogs } from '../db/schema'
import { estimateCost } from './pricing'
import type { UsageData } from '../providers/types'

export interface UsageRecord {
  apiKeyId: string
  accountId: string
  provider: string
  model: string
  usage: UsageData
  status: string
  latencyMs: number
}

/** Writes one usage-log row, computing cost from the token counts. */
export function recordUsage(record: UsageRecord): void {
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
        cost: estimateCost(record.provider, record.model, record.usage),
        status: record.status,
        latencyMs: record.latencyMs,
      })
      .run()
  } catch (err) {
    // Usage logging must never break the relay response.
    console.error('[usage] failed to record usage:', (err as Error).message)
  }
}
