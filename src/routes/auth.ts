import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getAdminUsername, verifyAdminCredentials } from '../auth/admin'
import { checkLoginRateLimit, getTurnstileSiteKey, verifyTurnstileToken } from '../auth/security'
import { UserManagerError, verifyUserCredentials, type UserView } from '../users/manager'
import { beginEmailRegistration, resendEmailRegistrationCode, verifyEmailRegistration } from '../users/emailRegistration'
import { emailRegistrationConfigured } from '../users/registrationEmail'
import { isRegistrationEnabled } from '../db/settings'
import { config } from '../config'
import { checkRateLimit } from '../middleware/limits'
import { db } from '../db'
import { accounts, usageLogs } from '../db/schema'
import { count, sql } from 'drizzle-orm'
import { inferProviderForModel, listModelIdsForKey } from '../providers/modelDiscovery'
import { resolvePrice } from '../usage/pricing'
import { getGoogleLoginClientId } from '../auth/google'
import { registerGoogleAuthRoutes } from './googleAuth'
import { GRSAI_MODELS } from '../providers/grsai/models'
import { publicModelProvider } from '../providers/publicIdentity'

const loginSchema = z.object({
  account: z.string().trim().min(1),
  password: z.string().min(1),
  turnstileToken: z.string().optional(),
})

const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(6).max(128),
  name: z.string().trim().min(1).max(60).optional(),
  turnstileToken: z.string().optional(),
})

const resendRegistrationSchema = z.object({
  email: z.string().email().max(254),
  turnstileToken: z.string().optional(),
})

const verifyRegistrationSchema = z.object({
  email: z.string().email().max(254),
  code: z.string().regex(/^\d{6}$/),
})

/** Max registration attempts per client IP per minute. */
const REGISTER_RATE_LIMIT = 5

function userSessionPayload(user: UserView) {
  return { sub: user.id, role: 'user', email: user.email, name: user.name }
}

export function registerAuthRoutes(app: FastifyInstance): void {
  registerGoogleAuthRoutes(app)
  // Public base-price catalog. Excludes account credentials and user/group markups.
  app.get('/api/auth/model-prices', async () => {
    const at = Date.now()
    const prices = listModelIdsForKey({ allowedProviders: null, allowedModels: null }).flatMap(model => {
      const provider = inferProviderForModel(model)
      if (GRSAI_MODELS.includes(model)) return []
      const price = provider ? resolvePrice(provider, model, at) : null
      return price ? [{ model, provider, inputPrice: price.input, outputPrice: price.output, cacheReadPrice: price.cacheRead,
        ...(model.startsWith('gpt-image-') ? { imageInputPrice: price.imageInput ?? 0, imageOutputPrice: price.imageOutput ?? 0,
          imageCacheReadPrice: price.imageCacheRead ?? price.cacheRead } : {}) }] : []
    })
    const supplierPrices = GRSAI_MODELS.map(model => {
      const price = resolvePrice('grsai', model, at)!
      return { model, provider: publicModelProvider('grsai', model), billingUnit: model === 'minimax-h3' ? 'second' : 'image', inputPrice: 0, outputPrice: 0,
        imageRequestPrice: price.imageRequest, videoSecond480Price: price.videoSecond480,
        videoSecond768Price: price.videoSecond768, videoSecond1080Price: price.videoSecond1080 }
    })
    return { updatedAt: at, prices: [...prices, ...supplierPrices] }
  })
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
      enabled: (await isRegistrationEnabled()) && emailRegistrationConfigured(),
      turnstileSiteKey: getTurnstileSiteKey(),
      googleClientId: getGoogleLoginClientId(),
    }
  })

  // Public: display hints for the web console. The stats timezone drives
  // client-side timestamp rendering so a log row's date always matches the
  // STATS_TIMEZONE day bucket / "today" card it was counted into.
  app.get('/api/auth/display-config', async () => {
    return { statsTimezone: config.STATS_TIMEZONE }
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
      providers: [...new Set(providers.flatMap(p => p.provider === 'grsai' ? ['modelbridge'] : [p.provider]))],
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
      const result = await beginEmailRegistration(body.data)
      return reply.code(202).send({ verificationRequired: true, email: body.data.email.trim().toLowerCase(), ...result })
    } catch (err) {
      if (err instanceof UserManagerError) {
        return reply.code(err.statusCode).send({ error: err.message })
      }
      throw err
    }
  })

  app.post('/api/auth/register/resend', async (request, reply) => {
    if (!(await isRegistrationEnabled())) return reply.code(403).send({ error: '当前未开放注册' })
    if (!(await checkRateLimit(`register-resend:${request.ip}`, REGISTER_RATE_LIMIT))) {
      return reply.code(429).send({ error: '验证码发送过于频繁，请稍后再试' })
    }
    const body = resendRegistrationSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid request body' })
    if (!(await verifyTurnstileToken(body.data.turnstileToken, request.ip))) {
      return reply.code(400).send({ error: '人机验证失败，请重试' })
    }
    try {
      const result = await resendEmailRegistrationCode(body.data.email)
      return { email: body.data.email.trim().toLowerCase(), ...result }
    } catch (err) {
      if (err instanceof UserManagerError) return reply.code(err.statusCode).send({ error: err.message })
      throw err
    }
  })

  app.post('/api/auth/register/verify', async (request, reply) => {
    if (!(await isRegistrationEnabled())) return reply.code(403).send({ error: '当前未开放注册' })
    if (!(await checkRateLimit(`register-verify:${request.ip}`, 10))) {
      return reply.code(429).send({ error: '验证码尝试过于频繁，请稍后再试' })
    }
    const body = verifyRegistrationSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: '请输入 6 位数字验证码' })
    try {
      const user = await verifyEmailRegistration(body.data.email, body.data.code)
      const token = app.jwt.sign(userSessionPayload(user), { expiresIn: '7d' })
      return reply.code(201).send({ role: 'user', token, user })
    } catch (err) {
      if (err instanceof UserManagerError) return reply.code(err.statusCode).send({ error: err.message })
      throw err
    }
  })
}
