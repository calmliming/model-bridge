import { randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/index'
import { accounts, apiKeys, oauthSessions, usageLogs } from '../db/schema'
import { changeAdminPassword, getAdminUsername, verifyAdminCredentials } from '../auth/admin'
import { createApiKey, deleteApiKey, listApiKeys, setApiKeyEnabled } from '../keys/manager'
import { createAccount, deleteAccount, listAccounts, setAccountStatus } from '../accounts/manager'
import { getProvider, isSupportedProvider } from '../providers/registry'
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

const oauthStartSchema = z.object({
  provider: z.enum(['claude', 'openai', 'gemini']),
  name: z.string().min(1),
})

const oauthFinishSchema = z.object({
  state: z.string().min(1),
  code: z.string().min(1),
})

const accountUpdateSchema = z.object({ status: z.enum(['active', 'disabled']) })

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

  // ── Upstream accounts ────────────────────────────────────
  app.get('/api/admin/accounts', { preHandler: requireAdmin }, async () => {
    return { accounts: listAccounts() }
  })

  // Step 1: store the chosen name + PKCE verifier, return the authorize URL.
  // `mode` tells the dashboard how to finish:
  //   'paste'    — Claude: user pastes the code back into the modal.
  //   'callback' — OpenAI: localhost:1455 callback completes the flow.
  app.post('/api/admin/accounts/oauth/start', { preHandler: requireAdmin }, async (request, reply) => {
    const body = oauthStartSchema.safeParse(request.body)
    if (!body.success || !isSupportedProvider(body.data.provider)) {
      return reply.code(400).send({ error: 'unsupported provider or missing name' })
    }
    const oauth = getProvider(body.data.provider)!
    const { verifier, challenge } = oauth.generatePkce()
    const state = randomBytes(16).toString('hex')
    db.insert(oauthSessions)
      .values({
        state,
        provider: body.data.provider,
        codeVerifier: verifier,
        accountName: body.data.name,
      })
      .run()
    return {
      state,
      authorizeUrl: oauth.buildAuthorizeUrl(state, challenge),
      mode: oauth.mode,
    }
  })

  // Step 2 (paste-mode providers only): exchange the pasted code for tokens.
  // For callback-mode providers, the dedicated :1455 listener does this instead.
  app.post('/api/admin/accounts/oauth/finish', { preHandler: requireAdmin }, async (request, reply) => {
    const body = oauthFinishSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid request body' })
    }
    const { state, code } = body.data
    const session = db
      .select()
      .from(oauthSessions)
      .where(eq(oauthSessions.state, state))
      .get()
    if (!session) {
      return reply.code(400).send({ error: 'OAuth session expired — please restart authorization' })
    }
    const oauth = getProvider(session.provider)
    if (!oauth) {
      return reply.code(400).send({ error: 'unsupported provider' })
    }
    let tokens
    try {
      tokens = await oauth.exchangeCode(code, session.codeVerifier, state)
    } catch (err) {
      return reply.code(400).send({ error: `authorization failed: ${(err as Error).message}` })
    }
    db.delete(oauthSessions).where(eq(oauthSessions.state, state)).run()
    const created = createAccount({
      provider: session.provider,
      name: session.accountName ?? `${session.provider} account`,
      tokens,
    })
    return reply.code(201).send({ id: created.id })
  })

  app.patch<{ Params: { id: string } }>(
    '/api/admin/accounts/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const body = accountUpdateSchema.safeParse(request.body)
      if (!body.success) {
        return reply.code(400).send({ error: 'invalid request body' })
      }
      setAccountStatus(request.params.id, body.data.status)
      return { ok: true }
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/admin/accounts/:id',
    { preHandler: requireAdmin },
    async (request) => {
      deleteAccount(request.params.id)
      return { ok: true }
    },
  )

  // ── Dashboard overview ───────────────────────────────────
  app.get('/api/admin/overview', { preHandler: requireAdmin }, async () => {
    return {
      keyCount: db.select({ n: count() }).from(apiKeys).get()?.n ?? 0,
      accountCount: db.select({ n: count() }).from(accounts).get()?.n ?? 0,
      requestCount: db.select({ n: count() }).from(usageLogs).get()?.n ?? 0,
    }
  })
}
