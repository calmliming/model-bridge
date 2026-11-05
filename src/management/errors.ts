import type { FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
const installed = new WeakSet<FastifyInstance>()
export function installManagementErrors(app: FastifyInstance): void {
  if (installed.has(app)) return
  installed.add(app)
  app.addHook('onError', async (_request, _reply, error) => {
    if (error instanceof ZodError) Object.assign(error, { statusCode: 400 })
  })
}
