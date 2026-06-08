import type { FastifyReply, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import { db } from '../db/index'
import { apiKeys } from '../db/schema'
import { findApiKeyBySecret } from '../keys/manager'
import { microsToUsd } from '../wallet/money'
import { hasWindowHeadroom, resolveActiveSubscription } from '../subscriptions/manager'

export interface AuthedApiKey {
  id: string
  name: string
  allowedProviders: string[] | null
  allowedModels: string[] | null
  modelMappings: Record<string, string> | null
  accountGroupId: string | null
  groupMultiplier: number
  rateLimit: number | null
  concurrencyLimit: number | null
  quotaLimit: number | null
  quotaUsed: number
  userId: string | null
  userBalance: number | null
  userBalanceMicros: number | null
  /** Which budget this request should bill to. */
  billTo: 'subscription' | 'balance'
  /** The subscription to charge when billTo === 'subscription'. */
  subscriptionId: string | null
}

/**
 * Extracts the platform API key from a request, supporting the auth
 * styles of the official clients:
 *   - `Authorization: Bearer <key>`  (Claude Code, Codex CLI, OpenAI)
 *   - `x-api-key: <key>`             (Anthropic)
 *   - `x-goog-api-key` / `?key=`     (Gemini)
 */
export function extractApiKey(request: FastifyRequest): string | undefined {
  const auth = request.headers['authorization']
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim()
  }
  const xApiKey = request.headers['x-api-key']
  if (typeof xApiKey === 'string' && xApiKey) return xApiKey
  const xGoog = request.headers['x-goog-api-key']
  if (typeof xGoog === 'string' && xGoog) return xGoog
  const queryKey = (request.query as Record<string, unknown> | undefined)?.['key']
  if (typeof queryKey === 'string' && queryKey) return queryKey
  return undefined
}

/**
 * preHandler hook for relay routes (used from Phase B onward): validates
 * the platform API key and attaches the record to `request.apiKey`.
 */
export async function requireApiKey(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const secret = extractApiKey(request)
  if (!secret) {
    reply.code(401).send({ error: 'missing API key' })
    return
  }
  const record = await findApiKeyBySecret(secret)
  if (!record || !record.enabled) {
    reply.code(401).send({ error: 'invalid or disabled API key' })
    return
  }
  if (record.expiresAt && record.expiresAt < Date.now()) {
    reply.code(401).send({ error: 'API key expired' })
    return
  }
  if (record.quotaLimit != null && record.quotaUsed >= record.quotaLimit) {
    reply.code(429).send({ error: 'API key quota exceeded' })
    return
  }
  let billTo: 'subscription' | 'balance' = 'balance'
  let subscriptionId: string | null = null

  if (!record.userId || !record.userStatus) {
    reply.code(401).send({ error: 'API key owner is unavailable' })
    return
  }
  if (record.userStatus !== 'active') {
    reply.code(401).send({ error: 'API key owner is disabled' })
    return
  }
  // Billing decision: prefer an active subscription for the key's group when
  // it still has window headroom; otherwise fall through to wallet balance.
  // Block (402) only when neither budget can cover further usage.
  const balanceMicros = record.userBalanceMicros ?? 0
  let subscriptionUsable = false
  if (record.accountGroupId) {
    const sub = await resolveActiveSubscription(record.userId, record.accountGroupId)
    if (sub) {
      subscriptionId = sub.subscriptionId
      subscriptionUsable = await hasWindowHeadroom(sub.subscriptionId, sub.planLimits)
    }
  }
  if (subscriptionUsable) {
    billTo = 'subscription'
  } else if (balanceMicros > 0) {
    billTo = 'balance'
  } else {
    reply.code(402).send({ error: 'insufficient balance' })
    return
  }
  await db.update(apiKeys).set({ lastUsedAt: Date.now() }).where(eq(apiKeys.id, record.id))
  request.apiKey = {
    id: record.id,
    name: record.name,
    allowedProviders: record.allowedProviders ?? null,
    allowedModels: record.allowedModels ?? null,
    modelMappings: record.modelMappings ?? null,
    accountGroupId: record.accountGroupId ?? null,
    groupMultiplier: record.groupMultiplier ?? 1,
    rateLimit: record.rateLimit ?? null,
    concurrencyLimit: record.concurrencyLimit ?? null,
    quotaLimit: record.quotaLimit ?? null,
    quotaUsed: record.quotaUsed,
    userId: record.userId,
    userBalanceMicros: record.userBalanceMicros ?? 0,
    userBalance: microsToUsd(record.userBalanceMicros ?? 0),
    billTo,
    subscriptionId,
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: AuthedApiKey
  }
}
