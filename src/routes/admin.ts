import type { FastifyInstance } from 'fastify'
import { count } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/index'
import { accounts, apiKeys, usageLogs } from '../db/schema'
import { changeAdminPassword, getAdminUsername, verifyAdminCredentials } from '../auth/admin'
import { createApiKey, deleteApiKey, listApiKeys, setApiKeyEnabled } from '../keys/manager'
import { requireAdmin } from '../middleware/adminAuth'

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
})

const createKeySchema = z.object({
  name: z.string().min(1),
  ownerLabel: z.string().optional(),
  allowedProviders: z.array(z.enum(['claude', 'openai', 'gemini'])).optional(),
  rateLimit: z.number().int().positive().optional(),
  quotaLimit: z.number().positive().optional(),
  expiresAt: z.number().int().optional(),
})

const updateKeySchema = z.object({ enabled: z.boolean() })

/** Registers all `/api/admin/*` endpoints used by the dashboard. */
export function registerAdminRoutes(app: FastifyInstance): void {
  // ── Authentication ───────────────────────────────────────
  app.post('/api/admin/login', async (request, reply) => {
    const body = loginSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid request body' })
    }
    if (!verifyAdminCredentials(body.data.username, body.data.password)) {
      return reply.code(401).send({ error: 'invalid username or password' })
    }
    const token = app.jwt.sign({ sub: body.data.username, role: 'admin' }, { expiresIn: '7d' })
    return { token, username: body.data.username }
  })

  app.get('/api/admin/me', { preHandler: requireAdmin }, async () => {
    return { username: getAdminUsername() }
  })

  app.post('/api/admin/change-password', { preHandler: requireAdmin }, async (request, reply) => {
    const body = changePasswordSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'new password must be at least 6 characters' })
    }
    if (!changeAdminPassword(body.data.currentPassword, body.data.newPassword)) {
      return reply.code(400).send({ error: 'current password is incorrect' })
    }
    return { ok: true }
  })

  // ── API keys ─────────────────────────────────────────────
  app.get('/api/admin/keys', { preHandler: requireAdmin }, async () => {
    return { keys: listApiKeys() }
  })

  app.post('/api/admin/keys', { preHandler: requireAdmin }, async (request, reply) => {
    const body = createKeySchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid request body' })
    }
    return reply.code(201).send(createApiKey(body.data))
  })

  app.patch<{ Params: { id: string } }>(
    '/api/admin/keys/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const body = updateKeySchema.safeParse(request.body)
      if (!body.success) {
        return reply.code(400).send({ error: 'invalid request body' })
      }
      setApiKeyEnabled(request.params.id, body.data.enabled)
      return { ok: true }
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/admin/keys/:id',
    { preHandler: requireAdmin },
    async (request) => {
      deleteApiKey(request.params.id)
      return { ok: true }
    },
  )

  // ── Upstream accounts (read-only stub — managed from Phase B) ─
  app.get('/api/admin/accounts', { preHandler: requireAdmin }, async () => {
    return { accounts: db.select().from(accounts).all() }
  })

  // ── Dashboard overview ───────────────────────────────────
  app.get('/api/admin/overview', { preHandler: requireAdmin }, async () => {
    return {
      keyCount: db.select({ n: count() }).from(apiKeys).get()?.n ?? 0,
      accountCount: db.select({ n: count() }).from(accounts).get()?.n ?? 0,
      requestCount: db.select({ n: count() }).from(usageLogs).get()?.n ?? 0,
    }
  })
}
