import type { FastifyReply, FastifyRequest } from 'fastify'

/**
 * preHandler hook: rejects the request unless it carries a valid admin
 * JWT (issued by `POST /api/admin/login`).
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify()
    const role = (request.user as { role?: string } | undefined)?.role
    if (role && role !== 'admin') {
      void reply.code(403).send({ error: 'admin access required' })
      return
    }
  } catch {
    void reply.code(401).send({ error: 'unauthorized' })
    return
  }
}
