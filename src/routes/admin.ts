import { randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/index'
import { oauthSessions } from '../db/schema'
import { changeAdminPassword, getAdminUsername, verifyAdminCredentials } from '../auth/admin'
import { createApiKey, deleteApiKey, getApiKeySecret, listApiKeys, updateApiKey } from '../keys/manager'
import { dashboardOverview, dashboardRecentLogs, statsSummary } from '../usage/stats'
import { createAccount, deleteAccount, listAccounts, setAccountGroup, setAccountStatus, setAccountWeight } from '../accounts/manager'
import { createGroup, deleteGroup, listGroups, updateGroup } from '../accounts/groups'
import { AccountTestError, testAccountConnectivity, testAllAccountsConnectivity } from '../accounts/tester'
import { getProvider, isSupportedProvider } from '../providers/registry'
import { requireAdmin } from '../middleware/adminAuth'
import { normalizeModelMappings } from '../keys/modelMapping'
import {
  createUserInvite,
  listUserUsage,
  listUsers,
  updateUser,
  UserManagerError,
} from '../users/manager'
import { adjustWalletUsd, listWalletTransactions } from '../wallet/manager'
import {
  cancelPaymentOrder,
  confirmPaymentOrder,
  listPaymentOrders,
  PaymentOrderError,
} from '../payments/manager'

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
})

const inviteUserSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).optional(),
})

const updateUserSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' })

const walletAdjustSchema = z.object({
  amount: z.number().refine((v) => Number.isFinite(v) && v !== 0, {
    message: 'amount must be non-zero',
  }),
  note: z.string().trim().max(500).optional(),
})

const createKeySchema = z.object({
  name: z.string().min(1),
  ownerLabel: z.string().optional(),
  allowedProviders: z.array(z.enum(['claude', 'openai', 'gemini', 'deepseek'])).optional(),
  allowedModels: z.array(z.string().trim().min(1)).optional(),
  modelMappings: z.record(z.string()).optional(),
  accountGroupId: z.string().trim().min(1).nullable().optional(),
  rateLimit: z.number().int().positive().optional(),
  concurrencyLimit: z.number().int().positive().optional(),
  quotaLimit: z.number().positive().optional(),
  expiresAt: z.number().int().optional(),
})

const updateKeySchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().min(1).optional(),
    ownerLabel: z.string().nullable().optional(),
    allowedProviders: z.array(z.enum(['claude', 'openai', 'gemini', 'deepseek'])).nullable().optional(),
    allowedModels: z.array(z.string().trim().min(1)).nullable().optional(),
    modelMappings: z.record(z.string()).nullable().optional(),
    accountGroupId: z.string().trim().min(1).nullable().optional(),
    rateLimit: z.number().int().positive().nullable().optional(),
    concurrencyLimit: z.number().int().positive().nullable().optional(),
    quotaLimit: z.number().positive().nullable().optional(),
    expiresAt: z.number().int().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' })

const idParamSchema = z.object({
  id: z.string().min(1),
})

const oauthStartSchema = z.object({
  provider: z.enum(['claude', 'openai', 'gemini']),
  name: z.string().min(1),
})

const oauthFinishSchema = z
  .object({
    state: z.string().optional(),
    code: z.string().optional(),
    callbackUrl: z.string().optional(),
  })
  .refine((v) => !!(v.state && v.code) || !!v.callbackUrl, {
    message: 'need (state+code) or callbackUrl',
  })

const accountUpdateSchema = z
  .object({
    status: z.enum(['active', 'disabled']).optional(),
    weight: z.number().int().min(1).max(100).optional(),
    groupId: z.string().trim().min(1).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' })

const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullable().optional(),
})

const updateGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' })

const importTokenSchema = z.object({
  provider: z.enum(['claude', 'openai', 'gemini', 'deepseek']),
  name: z.string().min(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().optional(),
  expiresAt: z.number().int().positive().optional(),
})

const accountHealthCheckSchema = z.object({
  provider: z.enum(['claude', 'openai', 'gemini', 'deepseek']).optional(),
}).optional()

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10),
})

const paymentOrdersQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['pending', 'paid', 'canceled', 'expired']).optional(),
})

const paymentOrderActionSchema = z.object({
  providerOrderId: z.string().trim().max(200).optional(),
  note: z.string().trim().max(500).optional(),
})

function sendUserManagerError(
  reply: { code: (statusCode: number) => { send: (body: unknown) => unknown } },
  err: unknown,
) {
  if (err instanceof UserManagerError) {
    return reply.code(err.statusCode).send({ error: err.message })
  }
  if (err instanceof PaymentOrderError) {
    return reply.code(err.statusCode).send({ error: err.message })
  }
  throw err
}

/** Registers all `/api/admin/*` endpoints used by the dashboard. */
export function registerAdminRoutes(app: FastifyInstance): void {
  // ── Authentication ───────────────────────────────────────
  app.post('/api/admin/login', async (request, reply) => {
    const body = loginSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid request body' })
    }
    if (!(await verifyAdminCredentials(body.data.username, body.data.password))) {
      return reply.code(401).send({ error: 'invalid username or password' })
    }
    const token = app.jwt.sign({ sub: body.data.username, role: 'admin' }, { expiresIn: '7d' })
    return { token, username: body.data.username }
  })

  app.get('/api/admin/me', { preHandler: requireAdmin }, async () => {
    return { username: await getAdminUsername() }
  })

  app.post('/api/admin/change-password', { preHandler: requireAdmin }, async (request, reply) => {
    const body = changePasswordSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'new password must be at least 6 characters' })
    }
    if (!(await changeAdminPassword(body.data.currentPassword, body.data.newPassword))) {
      return reply.code(400).send({ error: 'current password is incorrect' })
    }
    return { ok: true }
  })

  // ── SaaS users / wallet ─────────────────────────────────
  app.get('/api/admin/users', { preHandler: requireAdmin }, async () => {
    return { users: await listUsers() }
  })

  app.post('/api/admin/users/invite', { preHandler: requireAdmin }, async (request, reply) => {
    const body = inviteUserSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid request body' })
    }
    try {
      const createdBy = (request.user as { sub?: string } | undefined)?.sub ?? 'admin'
      const result = await createUserInvite({ ...body.data, createdBy })
      const host = request.headers.host ?? ''
      const origin =
        typeof request.headers.origin === 'string'
          ? request.headers.origin
          : host
            ? `http://${host}`
            : ''
      const inviteUrl = origin
        ? `${origin}/accept-invite?token=${encodeURIComponent(result.token)}`
        : `/accept-invite?token=${encodeURIComponent(result.token)}`
      return reply.code(201).send({ ...result, inviteUrl })
    } catch (err) {
      return sendUserManagerError(reply, err)
    }
  })

  app.patch<{ Params: { id: string } }>(
    '/api/admin/users/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params)
      const body = updateUserSchema.safeParse(request.body)
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: 'invalid request body' })
      }
      const user = await updateUser({ id: params.data.id, ...body.data })
      if (!user) return reply.code(404).send({ error: 'user not found' })
      return { user }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/admin/users/:id/wallet',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params)
      const body = walletAdjustSchema.safeParse(request.body)
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: 'invalid request body' })
      }
      try {
        const createdBy = (request.user as { sub?: string } | undefined)?.sub ?? 'admin'
        const transaction = await adjustWalletUsd({
          userId: params.data.id,
          amount: body.data.amount,
          note: body.data.note ?? null,
          createdBy,
        })
        return { transaction }
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message })
      }
    },
  )

  app.get<{ Params: { id: string }; Querystring: { page?: string; pageSize?: string } }>(
    '/api/admin/users/:id/wallet',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params)
      const query = paginationQuerySchema.safeParse(request.query)
      if (!params.success || !query.success) {
        return reply.code(400).send({ error: 'invalid request' })
      }
      return listWalletTransactions(params.data.id, query.data.page, query.data.pageSize)
    },
  )

  app.get<{ Params: { id: string }; Querystring: { page?: string; pageSize?: string } }>(
    '/api/admin/users/:id/usage',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params)
      const query = paginationQuerySchema.safeParse(request.query)
      if (!params.success || !query.success) {
        return reply.code(400).send({ error: 'invalid request' })
      }
      return listUserUsage(params.data.id, query.data.page, query.data.pageSize)
    },
  )

  app.get<{ Querystring: { page?: string; pageSize?: string; status?: string } }>(
    '/api/admin/payment-orders',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const query = paymentOrdersQuerySchema.safeParse(request.query)
      if (!query.success) {
        return reply.code(400).send({ error: 'invalid pagination query' })
      }
      return listPaymentOrders(query.data)
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/admin/payment-orders/:id/confirm',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params)
      const body = paymentOrderActionSchema.safeParse(request.body)
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: 'invalid request body' })
      }
      try {
        const paidBy = (request.user as { sub?: string } | undefined)?.sub ?? 'admin'
        const order = await confirmPaymentOrder({
          id: params.data.id,
          paidBy,
          providerOrderId: body.data.providerOrderId,
          note: body.data.note,
        })
        return { order }
      } catch (err) {
        return sendUserManagerError(reply, err)
      }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/admin/payment-orders/:id/cancel',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params)
      const body = paymentOrderActionSchema.safeParse(request.body)
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: 'invalid request body' })
      }
      try {
        const canceledBy = (request.user as { sub?: string } | undefined)?.sub ?? 'admin'
        const order = await cancelPaymentOrder({
          id: params.data.id,
          canceledBy,
          note: body.data.note,
        })
        return { order }
      } catch (err) {
        return sendUserManagerError(reply, err)
      }
    },
  )

  // ── API keys ─────────────────────────────────────────────
  app.get('/api/admin/keys', { preHandler: requireAdmin }, async () => {
    return { keys: await listApiKeys() }
  })

  app.post('/api/admin/keys', { preHandler: requireAdmin }, async (request, reply) => {
    const body = createKeySchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid request body' })
    }
    return reply.code(201).send(await createApiKey({
      ...body.data,
      modelMappings: normalizeModelMappings(body.data.modelMappings),
    }))
  })

  app.get<{ Params: { id: string } }>(
    '/api/admin/keys/:id/secret',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params)
      if (!params.success) {
        return reply.code(400).send({ error: 'invalid key id' })
      }
      const key = await getApiKeySecret(params.data.id)
      if (!key) {
        return reply.code(404).send({ error: 'full API key is unavailable; recreate this key to enable copy' })
      }
      return { key }
    },
  )

  app.patch<{ Params: { id: string } }>(
    '/api/admin/keys/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const body = updateKeySchema.safeParse(request.body)
      if (!body.success) {
        return reply.code(400).send({ error: 'invalid request body' })
      }
      await updateApiKey(request.params.id, {
        ...body.data,
        modelMappings:
          'modelMappings' in body.data
            ? normalizeModelMappings(body.data.modelMappings)
            : undefined,
      })
      return { ok: true }
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/admin/keys/:id',
    { preHandler: requireAdmin },
    async (request) => {
      await deleteApiKey(request.params.id)
      return { ok: true }
    },
  )

  // ── Account groups ───────────────────────────────────────
  app.get('/api/admin/account-groups', { preHandler: requireAdmin }, async () => {
    return { groups: await listGroups() }
  })

  app.post('/api/admin/account-groups', { preHandler: requireAdmin }, async (request, reply) => {
    const body = createGroupSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid request body' })
    }
    return reply.code(201).send(await createGroup(body.data))
  })

  app.patch<{ Params: { id: string } }>(
    '/api/admin/account-groups/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params)
      const body = updateGroupSchema.safeParse(request.body)
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: 'invalid request body' })
      }
      await updateGroup(params.data.id, body.data)
      return { ok: true }
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/admin/account-groups/:id',
    { preHandler: requireAdmin },
    async (request) => {
      await deleteGroup(request.params.id)
      return { ok: true }
    },
  )

  // ── Upstream accounts ────────────────────────────────────
  app.get('/api/admin/accounts', { preHandler: requireAdmin }, async () => {
    return { accounts: await listAccounts() }
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
    await db.insert(oauthSessions)
      .values({
        state,
        provider: body.data.provider,
        codeVerifier: verifier,
        accountName: body.data.name,
      })
    return {
      state,
      authorizeUrl: oauth.buildAuthorizeUrl(state, challenge),
      mode: oauth.mode,
    }
  })

  // Step 2 (paste & callback-mode): exchange the pasted code for tokens.
  // For callback-mode providers, users can paste the full redirect URL from the
  // browser address bar when localhost:1455 isn't reachable (e.g. remote server).
  app.post('/api/admin/accounts/oauth/finish', { preHandler: requireAdmin }, async (request, reply) => {
    const body = oauthFinishSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid request body' })
    }
    let { state, code } = body.data
    // Parse callback URL if pasted: http://localhost:1455/auth/callback?code=...&state=...
    if (body.data.callbackUrl) {
      try {
        const url = new URL(body.data.callbackUrl)
        code = url.searchParams.get('code') ?? undefined
        state = url.searchParams.get('state') ?? undefined
        if (!code || !state) {
          return reply.code(400).send({ error: 'URL 中缺少 code 或 state 参数' })
        }
      } catch {
        // If URL parsing fails, try regex extraction
        const codeMatch = body.data.callbackUrl.match(/[?&]code=([^&]+)/)
        const stateMatch = body.data.callbackUrl.match(/[?&]state=([^&]+)/)
        code = codeMatch?.[1]
        state = stateMatch?.[1]
        if (!code || !state) {
          return reply.code(400).send({ error: '无法从 URL 中提取 code/state 参数' })
        }
      }
    }
    if (!code || !state) {
      return reply.code(400).send({ error: 'missing code or state' })
    }
    const [session] = await db
      .select()
      .from(oauthSessions)
      .where(eq(oauthSessions.state, state))
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
    let metadata: Record<string, unknown> | null = null
    if (oauth.fetchAccountMetadata) {
      try {
        metadata = await oauth.fetchAccountMetadata(tokens.accessToken)
      } catch (err) {
        return reply
          .code(400)
          .send({ error: `account setup failed: ${(err as Error).message}` })
      }
    }
    await db.delete(oauthSessions).where(eq(oauthSessions.state, state))
    const created = await createAccount({
      provider: session.provider,
      name: session.accountName ?? `${session.provider} account`,
      tokens,
      metadata,
    })
    return reply.code(201).send({ id: created.id })
  })

  // Direct token import: skip OAuth and create an account from a manually-
  // supplied access token (and optionally a refresh token). Useful for remote
  // servers where the OAuth callback to localhost:1455 can't work.
  app.post(
    '/api/admin/accounts/import/token',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const body = importTokenSchema.safeParse(request.body)
      if (!body.success) {
        return reply.code(400).send({ error: 'invalid request body' })
      }
      const { provider, name, accessToken, refreshToken, expiresAt } = body.data
      const created = await createAccount({
        provider,
        name,
        tokens: {
          accessToken,
          refreshToken: refreshToken ?? '',
          expiresAt: expiresAt ?? 0,
        },
        metadata: null,
      })
      return reply.code(201).send({ id: created.id, name, provider })
    },
  )

  app.patch<{ Params: { id: string } }>(
    '/api/admin/accounts/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const body = accountUpdateSchema.safeParse(request.body)
      if (!body.success) {
        return reply.code(400).send({ error: 'invalid request body' })
      }
      if (body.data.status) await setAccountStatus(request.params.id, body.data.status)
      if (body.data.weight !== undefined) await setAccountWeight(request.params.id, body.data.weight)
      if ('groupId' in body.data) await setAccountGroup(request.params.id, body.data.groupId ?? null)
      return { ok: true }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/admin/accounts/:id/test',
    { preHandler: requireAdmin },
    async (request, reply) => {
      try {
        return await testAccountConnectivity(request.params.id)
      } catch (err) {
        if (err instanceof AccountTestError && err.statusCode === 404) {
          return reply.code(404).send({ success: false, error: err.message })
        }
        return {
          success: false,
          message: err instanceof Error ? err.message : 'account connectivity test failed',
          latencyMs: 0,
          checkedAt: Date.now(),
        }
      }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/admin/accounts/:id/quota/refresh',
    { preHandler: requireAdmin },
    async (request, reply) => {
      try {
        return await testAccountConnectivity(request.params.id)
      } catch (err) {
        if (err instanceof AccountTestError && err.statusCode === 404) {
          return reply.code(404).send({ success: false, error: err.message })
        }
        return {
          success: false,
          message: err instanceof Error ? err.message : 'account quota refresh failed',
          latencyMs: 0,
          checkedAt: Date.now(),
        }
      }
    },
  )

  app.post('/api/admin/accounts/health/check', { preHandler: requireAdmin }, async (request, reply) => {
    const body = accountHealthCheckSchema.safeParse(request.body ?? {})
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid request body' })
    }
    return await testAllAccountsConnectivity(body.data?.provider)
  })

  app.delete<{ Params: { id: string } }>(
    '/api/admin/accounts/:id',
    { preHandler: requireAdmin },
    async (request) => {
      await deleteAccount(request.params.id)
      return { ok: true }
    },
  )

  // ── Dashboard overview ───────────────────────────────────
  app.get('/api/admin/overview', { preHandler: requireAdmin }, async () => {
    return await dashboardOverview()
  })

  // Dashboard recent calls
  app.get<{ Querystring: { page?: string; pageSize?: string } }>(
    '/api/admin/overview/recent-logs',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const query = paginationQuerySchema.safeParse(request.query)
      if (!query.success) {
        return reply.code(400).send({ error: 'invalid pagination query' })
      }
      return await dashboardRecentLogs(query.data.page, query.data.pageSize)
    },
  )

  // Usage statistics
  app.get<{ Querystring: { days?: string } }>(
    '/api/admin/stats/summary',
    { preHandler: requireAdmin },
    async (request) => {
      const days = request.query.days ? Number(request.query.days) : 30
      return await statsSummary(days)
    },
  )
}
