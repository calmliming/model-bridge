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
  } catch {
    reply.code(401).send({ error: 'unauthorized' })
  }
}
