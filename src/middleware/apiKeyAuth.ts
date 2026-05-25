import type { FastifyReply, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import { db } from '../db/index'
import { apiKeys } from '../db/schema'
import { findApiKeyBySecret } from '../keys/manager'

export interface AuthedApiKey {
  id: string
  name: string
  allowedProviders: string[] | null
  allowedModels: string[] | null
  rateLimit: number | null
  quotaLimit: number | null
  quotaUsed: number
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
  await db.update(apiKeys).set({ lastUsedAt: Date.now() }).where(eq(apiKeys.id, record.id))
  request.apiKey = {
    id: record.id,
    name: record.name,
    allowedProviders: record.allowedProviders ?? null,
    allowedModels: record.allowedModels ?? null,
    rateLimit: record.rateLimit ?? null,
    quotaLimit: record.quotaLimit ?? null,
    quotaUsed: record.quotaUsed,
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: AuthedApiKey
  }
}
