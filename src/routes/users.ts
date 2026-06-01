import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createApiKey, deleteApiKey, getApiKeySecret, listApiKeysForUser, updateApiKey } from '../keys/manager'
import { normalizeModelMappings } from '../keys/modelMapping'
import { requireUser } from '../middleware/userAuth'
import {
  acceptInvite,
  listUserUsage,
  UserManagerError,
  verifyUserCredentials,
} from '../users/manager'
import { listWalletTransactions } from '../wallet/manager'

const providerSchema = z.enum(['claude', 'openai', 'gemini', 'deepseek'])

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

function userSessionPayload(user: { id: string; email: string; name: string }) {
  return { sub: user.id, role: 'user', email: user.email, name: user.name }
}

function sendUserError(reply: { code: (statusCode: number) => { send: (body: unknown) => unknown } }, err: unknown) {
  if (err instanceof UserManagerError) {
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

  app.get('/api/users/wallet', { preHandler: requireUser }, async (request) => {
    return {
      user: request.currentUser!,
      ...(await listWalletTransactions(request.currentUser!.id, 1, 10)),
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

  app.get<{ Querystring: { page?: string; pageSize?: string } }>(
    '/api/users/usage',
    { preHandler: requireUser },
    async (request, reply) => {
      const query = paginationQuerySchema.safeParse(request.query)
      if (!query.success) {
        return reply.code(400).send({ error: 'invalid pagination query' })
      }
      return listUserUsage(request.currentUser!.id, query.data.page, query.data.pageSize)
    },
  )

  app.get('/api/users/keys', { preHandler: requireUser }, async (request) => {
    return { keys: await listApiKeysForUser(request.currentUser!.id) }
  })

  app.post('/api/users/keys', { preHandler: requireUser }, async (request, reply) => {
    const body = createKeySchema.safeParse(request.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid request body' })
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
