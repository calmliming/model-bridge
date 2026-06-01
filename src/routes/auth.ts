import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getAdminUsername, verifyAdminCredentials } from '../auth/admin'
import { verifyUserCredentials, type UserView } from '../users/manager'

const loginSchema = z.object({
  account: z.string().trim().min(1),
  password: z.string().min(1),
})

function userSessionPayload(user: UserView) {
  return { sub: user.id, role: 'user', email: user.email, name: user.name }
}

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post('/api/auth/login', async (request, reply) => {
    const body = loginSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid request body' })
    }

    const { account, password } = body.data
    if (await verifyAdminCredentials(account, password)) {
      const username = await getAdminUsername()
      const token = app.jwt.sign({ sub: username, role: 'admin' }, { expiresIn: '7d' })
      return { role: 'admin', token, username }
    }

    const user = await verifyUserCredentials(account, password)
    if (user) {
      const token = app.jwt.sign(userSessionPayload(user), { expiresIn: '7d' })
      return { role: 'user', token, user }
    }

    return reply.code(401).send({ error: 'invalid account or password' })
  })
}
