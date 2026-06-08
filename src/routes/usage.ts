import type { FastifyInstance } from 'fastify'
import { extractApiKey } from '../middleware/apiKeyAuth'
import { findApiKeyBySecret } from '../keys/manager'
import { microsToUsd } from '../wallet/money'

/**
 * Balance endpoint for CC Switch's usage-query feature (shows "剩余 X USD" on the
 * provider card). Authenticated directly by the platform API key (mb-…) — it
 * deliberately skips requireApiKey's billing gate and lastUsedAt write, so it can
 * report a zero balance instead of being blocked with 402, and a balance poll
 * doesn't count as "last used".
 */
export function registerUsageRoutes(app: FastifyInstance): void {
  app.get('/api/usage', async (request, reply) => {
    const secret = extractApiKey(request)
    if (!secret) {
      return reply.code(401).send({ error: 'missing API key' })
    }
    const record = await findApiKeyBySecret(secret)
    if (!record || !record.enabled) {
      return reply.code(401).send({ error: 'invalid or disabled API key' })
    }
    if (record.expiresAt && record.expiresAt < Date.now()) {
      return reply.code(401).send({ error: 'API key expired' })
    }
    // User keys report the owner's wallet balance; standalone keys with a per-key
    // quota report their remaining quota headroom. Otherwise there's nothing to show.
    let balance: number | null = null
    if (record.userId) {
      balance = microsToUsd(record.userBalanceMicros ?? 0)
    } else if (record.quotaLimit != null) {
      balance = Math.max(0, record.quotaLimit - record.quotaUsed)
    }
    return reply.send({
      balance,
      used: record.quotaUsed,
      limit: record.quotaLimit ?? null,
      currency: 'USD',
    })
  })
}
