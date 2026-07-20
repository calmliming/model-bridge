import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createApiKey, deleteApiKey, getApiKeySecret, listApiKeysForUser, updateApiKey } from '../keys/manager'
import { normalizeModelMappings } from '../keys/modelMapping'
import { groupExists, listGroups } from '../accounts/groups'
import { requireUser } from '../middleware/userAuth'
import {
  acceptInvite,
  listUserUsage,
  userUsageSummary,
  UserManagerError,
  verifyUserCredentials,
} from '../users/manager'
import { listWalletTransactions } from '../wallet/manager'
import { createPaymentOrder, listPaymentOrdersForUser, PaymentOrderError } from '../payments/manager'
import { getAvailableProviders } from '../payments/providers/index'
import { redeemCode, RedeemError } from '../redeem/manager'
import { checkRateLimit } from '../middleware/limits'
import {
  listPlans,
  listUserSubscriptions,
  purchaseSubscription,
  SubscriptionError,
} from '../subscriptions/manager'

const providerSchema = z.enum(['claude', 'openai', 'gemini', 'deepseek', 'xiaomi', 'zhipu', 'qwen', 'kimi', 'sub2api'])

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const acceptInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(6),
  name: z.string().trim().min(1).optional(),
})

const createKeySchema = z.object({
  name: z.string().min(1),
  allowedProviders: z.array(providerSchema).optional(),
  allowedModels: z.array(z.string().trim().min(1)).optional(),
  modelMappings: z.record(z.string()).optional(),
  accountGroupId: z.string().min(1).nullable().optional(),
  rateLimit: z.number().int().positive().optional(),
  concurrencyLimit: z.number().int().positive().optional(),
  quotaLimit: z.number().positive().optional(),
  expiresAt: z.number().int().optional(),
})

const updateKeySchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().min(1).optional(),
    allowedProviders: z.array(providerSchema).nullable().optional(),
    allowedModels: z.array(z.string().trim().min(1)).nullable().optional(),
    modelMappings: z.record(z.string()).nullable().optional(),
    accountGroupId: z.string().min(1).nullable().optional(),
    rateLimit: z.number().int().positive().nullable().optional(),
    concurrencyLimit: z.number().int().positive().nullable().optional(),
    quotaLimit: z.number().positive().nullable().optional(),
    expiresAt: z.number().int().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' })

const idParamSchema = z.object({ id: z.string().min(1) })

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
})

const usageQuerySchema = paginationQuerySchema.extend({
  startDate: z.coerce.number().int().positive().optional(),
  endDate: z.coerce.number().int().positive().optional(),
})

const createPaymentOrderSchema = z.object({
  amount: z.number().refine((v) => Number.isFinite(v) && v > 0, {
    message: 'amount must be positive',
  }),
  provider: z.enum(['manual', 'alipay', 'wechat']).optional(),
})

const redeemSchema = z.object({
  code: z.string().trim().min(1).max(100),
})

const purchaseSchema = z.object({
  planId: z.string().trim().min(1),
})

/** Max redeem attempts per user per minute — guards against code enumeration. */
const REDEEM_RATE_LIMIT = 10

function userSessionPayload(user: { id: string; email: string; name: string }) {
  return { sub: user.id, role: 'user', email: user.email, name: user.name }
}

function sendUserError(reply: { code: (statusCode: number) => { send: (body: unknown) => unknown } }, err: unknown) {
  if (err instanceof UserManagerError) {
    return reply.code(err.statusCode).send({ error: err.message })
  }
  if (err instanceof PaymentOrderError) {
    return reply.code(err.statusCode).send({ error: err.message })
  }
  if (err instanceof RedeemError) {
    return reply.code(err.statusCode).send({ error: err.message })
  }
  if (err instanceof SubscriptionError) {
    return reply.code(err.statusCode).send({ error: err.message })
  }
  throw err
}

export function registerUserRoutes(app: FastifyInstance): void {
  app.post('/api/users/login', async (request, reply) => {
    const body = loginSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid request body' })
    }
    const user = await verifyUserCredentials(body.data.email, body.data.password)
    if (!user) {
      return reply.code(401).send({ error: 'invalid email or password' })
    }
    const token = app.jwt.sign(userSessionPayload(user), { expiresIn: '7d' })
    return { token, user }
  })

  app.post('/api/users/invites/accept', async (request, reply) => {
    const body = acceptInviteSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid request body' })
    }
    try {
      const user = await acceptInvite(body.data)
      const token = app.jwt.sign(userSessionPayload(user), { expiresIn: '7d' })
      return { token, user }
    } catch (err) {
      return sendUserError(reply, err)
    }
  })

  app.get('/api/users/me', { preHandler: requireUser }, async (request) => {
    return { user: request.currentUser! }
  })

  app.get('/api/users/payment-providers', { preHandler: requireUser }, async () => {
    return { providers: getAvailableProviders() }
  })

  app.get('/api/users/wallet', { preHandler: requireUser }, async (request) => {
    return {
      user: request.currentUser!,
      ...(await listWalletTransactions(request.currentUser!.id, 1, 10)),
    }
  })

  app.post('/api/users/payment-orders', { preHandler: requireUser }, async (request, reply) => {
    const body = createPaymentOrderSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid request body' })
    }
    try {
      const order = await createPaymentOrder({
        userId: request.currentUser!.id,
        amount: body.data.amount,
        provider: body.data.provider,
      })
      return reply.code(201).send({ order })
    } catch (err) {
      return sendUserError(reply, err)
    }
  })

  app.get<{ Querystring: { page?: string; pageSize?: string } }>(
    '/api/users/payment-orders',
    { preHandler: requireUser },
    async (request, reply) => {
      const query = paginationQuerySchema.safeParse(request.query)
      if (!query.success) {
        return reply.code(400).send({ error: 'invalid pagination query' })
      }
      return listPaymentOrdersForUser(request.currentUser!.id, query.data.page, query.data.pageSize)
    },
  )

  app.post('/api/users/redeem', { preHandler: requireUser }, async (request, reply) => {
    const body = redeemSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid request body' })
    }
    const userId = request.currentUser!.id
    if (!(await checkRateLimit(`redeem:${userId}`, REDEEM_RATE_LIMIT))) {
      return reply.code(429).send({ error: '兑换尝试过于频繁，请稍后再试' })
    }
    try {
      const result = await redeemCode(userId, body.data.code)
      return { ok: true, ...result }
    } catch (err) {
      return sendUserError(reply, err)
    }
  })

  app.get('/api/users/subscriptions', { preHandler: requireUser }, async (request) => {
    return { subscriptions: await listUserSubscriptions(request.currentUser!.id) }
  })

  app.get('/api/users/subscription-plans', { preHandler: requireUser }, async () => {
    return { plans: await listPlans(true) }
  })

  app.post('/api/users/subscriptions/purchase', { preHandler: requireUser }, async (request, reply) => {
    const body = purchaseSchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid request body' })
    }
    try {
      const result = await purchaseSubscription(request.currentUser!.id, body.data.planId)
      return reply.code(201).send({ ok: true, ...result })
    } catch (err) {
      return sendUserError(reply, err)
    }
  })

  app.get<{ Querystring: { page?: string; pageSize?: string } }>(
    '/api/users/wallet/transactions',
    { preHandler: requireUser },
    async (request, reply) => {
      const query = paginationQuerySchema.safeParse(request.query)
      if (!query.success) {
        return reply.code(400).send({ error: 'invalid pagination query' })
      }
      return listWalletTransactions(request.currentUser!.id, query.data.page, query.data.pageSize)
    },
  )

  app.get<{ Querystring: { page?: string; pageSize?: string; startDate?: string; endDate?: string } }>(
    '/api/users/usage',
    { preHandler: requireUser },
    async (request, reply) => {
      const query = usageQuerySchema.safeParse(request.query)
      if (!query.success) {
        return reply.code(400).send({ error: 'invalid query' })
      }
      return listUserUsage(request.currentUser!.id, query.data.page, query.data.pageSize, {
        startDate: query.data.startDate,
        endDate: query.data.endDate,
      })
    },
  )

  app.get('/api/users/usage/summary', { preHandler: requireUser }, async (request) => {
    return userUsageSummary(request.currentUser!.id)
  })

  // Read-only group list so users can bind a key to a group (but not manage groups).
  app.get('/api/users/account-groups', { preHandler: requireUser }, async () => {
    const groups = await listGroups()
    return {
      groups: groups.map((g) => ({ id: g.id, name: g.name, rateMultiplier: g.rateMultiplier })),
    }
  })

  app.get('/api/users/keys', { preHandler: requireUser }, async (request) => {
    return { keys: await listApiKeysForUser(request.currentUser!.id) }
  })

  app.post('/api/users/keys', { preHandler: requireUser }, async (request, reply) => {
    const body = createKeySchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid request body' })
    }
    if (body.data.accountGroupId && !(await groupExists(body.data.accountGroupId))) {
      return reply.code(400).send({ error: 'account group not found' })
    }
    const user = request.currentUser!
    return reply.code(201).send(await createApiKey({
      ...body.data,
      userId: user.id,
      ownerLabel: user.name || user.email,
      modelMappings: normalizeModelMappings(body.data.modelMappings),
    }))
  })

  app.get<{ Params: { id: string } }>(
    '/api/users/keys/:id/secret',
    { preHandler: requireUser },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params)
      if (!params.success) {
        return reply.code(400).send({ error: 'invalid key id' })
      }
      const key = await getApiKeySecret(params.data.id, request.currentUser!.id)
      if (!key) {
        return reply.code(404).send({ error: 'full API key is unavailable' })
      }
      return { key }
    },
  )

  app.patch<{ Params: { id: string } }>(
    '/api/users/keys/:id',
    { preHandler: requireUser },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params)
      const body = updateKeySchema.safeParse(request.body)
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: 'invalid request body' })
      }
      if (body.data.accountGroupId && !(await groupExists(body.data.accountGroupId))) {
        return reply.code(400).send({ error: 'account group not found' })
      }
      await updateApiKey(params.data.id, {
        ...body.data,
        modelMappings:
          'modelMappings' in body.data
            ? normalizeModelMappings(body.data.modelMappings)
            : undefined,
      }, request.currentUser!.id)
      return { ok: true }
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/users/keys/:id',
    { preHandler: requireUser },
    async (request, reply) => {
      const params = idParamSchema.safeParse(request.params)
      if (!params.success) {
        return reply.code(400).send({ error: 'invalid key id' })
      }
      await deleteApiKey(params.data.id, request.currentUser!.id)
      return { ok: true }
    },
  )
}
