import type { FastifyReply, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import { getAdminUserId } from '../auth/admin'
import { db } from '../db'
import { accountGroups } from '../db/schema'
import { getUserById } from '../users/manager'
import { requireAdmin } from './adminAuth'
import { resolveRelayBilling } from './apiKeyAuth'
import { requireUser } from './userAuth'

export const studioScopes = [
  { prefix: '/api/users/studio', admin: false },
  { prefix: '/api/admin/studio', admin: true },
] as const

export function requireStudioSession(admin: boolean, resultOnly = false) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await (admin ? requireAdmin : requireUser)(request, reply)
    if (reply.sent) return

    let user = request.currentUser
    if (admin) {
      const adminId = await getAdminUserId()
      user = adminId ? await getUserById(adminId) ?? undefined : undefined
    }
    if (!user || user.status !== 'active') {
      void reply.code(401).send({ error: 'user disabled or missing' })
      return
    }

    const groupId = resultOnly ? undefined : (request.query as { groupId?: unknown }).groupId
    if (groupId !== undefined && (typeof groupId !== 'string' || !groupId || groupId.length > 100)) {
      void reply.code(400).send({ error: '无效的生成渠道' })
      return
    }
    const group = groupId ? (await db.select().from(accountGroups).where(eq(accountGroups.id, groupId)))[0] : undefined
    if (groupId && !group) {
      void reply.code(400).send({ error: '生成渠道已不存在，请重新选择' })
      return
    }
    const billing = await resolveRelayBilling(reply, user.id, group?.id ?? null, user.balanceMicros, resultOnly)
    if (!billing) return

    // The relay uses this stable ID for reservations and logs. It has no secret
    // and cannot authenticate against the public API Key endpoints.
    request.apiKey = {
      id: `studio:${user.id}`,
      name: '创作工作台',
      allowedProviders: ['grsai'],
      allowedModels: null,
      modelMappings: null,
      accountGroupId: group?.id ?? null,
      groupMultiplier: group?.rateMultiplier ?? 1,
      groupAllowedModels: group?.allowedModels ?? null,
      rateLimit: null,
      concurrencyLimit: null,
      userConcurrencyLimit: user.concurrencyLimit,
      quotaLimit: null,
      quotaUsed: 0,
      userId: user.id,
      userBalance: user.balance,
      userBalanceMicros: user.balanceMicros,
      ...billing,
    }
  }
}
