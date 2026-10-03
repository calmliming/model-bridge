import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAdmin } from '../middleware/adminAuth'
import { requireUser } from '../middleware/userAuth'
import { MODEL_MANUFACTURERS } from '../usage/manufacturers'
import { listRequestLogs } from '../usage/requestLogs'

const querySchema = z.object({
  id: z.string().max(120).regex(/^[\w:-]+$/).optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  manufacturer: z.string().refine(value => MODEL_MANUFACTURERS.some(item => item.id === value)).optional(),
  kind: z.enum(['text', 'image', 'video']).optional(),
  status: z.enum(['running', 'settling', 'success', 'error']).optional(),
  model: z.string().trim().max(160).optional(),
  key: z.string().trim().max(120).optional(),
  startDate: z.coerce.number().int().positive().optional(),
  endDate: z.coerce.number().int().positive().optional(),
}).refine(value => value.startDate == null || value.endDate == null || value.startDate <= value.endDate)

export function registerRequestLogRoutes(app: FastifyInstance): void {
  for (const role of ['admin', 'users'] as const) {
    app.get(`/api/${role}/logs`, { preHandler: role === 'admin' ? requireAdmin : requireUser }, async (request, reply) => {
      const parsed = querySchema.safeParse(request.query)
      if (!parsed.success) return reply.code(400).send({ error: '日志筛选参数无效' })
      const { page, pageSize, ...filters } = parsed.data
      return listRequestLogs(page, pageSize, filters, role === 'users' ? request.currentUser!.id : undefined)
    })
  }
}
