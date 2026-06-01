import type { FastifyReply, FastifyRequest } from 'fastify'
import { getUserById, type UserView } from '../users/manager'

export async function requireUser(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify()
  } catch {
    void reply.code(401).send({ error: 'unauthorized' })
    return
  }
  const jwtUser = request.user as { sub?: string; role?: string } | undefined
  if (jwtUser?.role !== 'user' || !jwtUser.sub) {
    void reply.code(403).send({ error: 'user access required' })
    return
  }
  const user = await getUserById(jwtUser.sub)
  if (!user || user.status !== 'active') {
    void reply.code(401).send({ error: 'user disabled or missing' })
    return
  }
  request.currentUser = user
}

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: UserView
  }
}
