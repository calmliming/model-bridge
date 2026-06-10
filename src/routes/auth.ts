import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getAdminUsername, verifyAdminCredentials } from '../auth/admin'
import { checkLoginRateLimit, getTurnstileSiteKey, verifyTurnstileToken } from '../auth/security'
import { registerUser, UserManagerError, verifyUserCredentials, type UserView } from '../users/manager'
import { isRegistrationEnabled } from '../db/settings'
import { checkRateLimit } from '../middleware/limits'
import { db } from '../db'
import { accounts, usageLogs } from '../db/schema'
import { count, sql } from 'drizzle-orm'

const loginSchema = z.object({
  account: z.string().trim().min(1),
  password: z.string().min(1),
  turnstileToken: z.string().optional(),
})

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().trim().min(1).max(60).optional(),
  turnstileToken: z.string().optional(),
})

/** Max registration attempts per client IP per minute. */
const REGISTER_RATE_LIMIT = 5

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
    if (!(await checkLoginRateLimit(request.ip, account))) {
      return reply.code(429).send({ error: '登录尝试过于频繁，请稍后再试' })
    }
    if (!(await verifyTurnstileToken(body.data.turnstileToken, request.ip))) {
      return reply.code(400).send({ error: '人机验证失败，请重试' })
    }

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

  // Public: the login page reads this to show/hide the registration entry.
  app.get('/api/auth/registration-status', async () => {
    return {
      enabled: await isRegistrationEnabled(),
      turnstileSiteKey: getTurnstileSiteKey(),
    }
  })

  // Public: system summary for the landing page.
  app.get('/api/auth/system-summary', async () => {
    const [accountCount] = await db.select({ value: count() }).from(accounts)
    const [requestCount] = await db.select({ value: count() }).from(usageLogs)
    const providers = await db
      .select({ provider: accounts.provider })
      .from(accounts)
      .groupBy(accounts.provider)

    return {
      registrationEnabled: await isRegistrationEnabled(),
      accounts: accountCount.value,
      requests: requestCount.value,
      providers: providers.map((p) => p.provider),
    }
  })

  app.post('/api/auth/register', async (request, reply) => {
    if (!(await isRegistrationEnabled())) {
      return reply.code(403).send({ error: '当前未开放注册' })
    }
    if (!(await checkRateLimit(`register:${request.ip}`, REGISTER_RATE_LIMIT))) {
      return reply.code(429).send({ error: '注册过于频繁，请稍后再试' })
    }
    const body = registerSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid request body' })
    }
    if (!(await verifyTurnstileToken(body.data.turnstileToken, request.ip))) {
      return reply.code(400).send({ error: '人机验证失败，请重试' })
    }
    try {
      const user = await registerUser(body.data)
      const token = app.jwt.sign(userSessionPayload(user), { expiresIn: '7d' })
      return reply.code(201).send({ role: 'user', token, user })
    } catch (err) {
      if (err instanceof UserManagerError) {
        return reply.code(err.statusCode).send({ error: err.message })
      }
      throw err
    }
  })
}
