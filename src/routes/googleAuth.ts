import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { consumeGoogleNonce, createGoogleNonce, getGoogleLoginClientId, GoogleAuthError,
  googleNonceValid, GOOGLE_NONCE_TTL_SECONDS, verifyGoogleCredential } from '../auth/google'
import { checkLoginRateLimit } from '../auth/security'
import { checkRateLimit } from '../middleware/limits'
import { isRegistrationEnabled } from '../db/settings'
import { GoogleLinkRequiredError, signInGoogleUser } from '../users/google'
import { UserManagerError } from '../users/manager'

const loginSchema = z.object({
  credential: z.string().min(1).max(16_384),
  password: z.string().min(1).max(1024).optional(),
})

function cookieName(request: FastifyRequest): string {
  return request.protocol === 'https' ? '__Host-mb_google_nonce' : 'mb_google_nonce'
}

function setNonceCookie(request: FastifyRequest, reply: FastifyReply, nonce: string, maxAge: number): void {
  reply.header('Set-Cookie', `${cookieName(request)}=${nonce}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${request.protocol === 'https' ? '; Secure' : ''}`)
}

function readNonceCookie(request: FastifyRequest): string {
  const prefix = `${cookieName(request)}=`
  const cookies = (request.headers.cookie ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(prefix))
  return cookies.length === 1 ? cookies[0]!.slice(prefix.length) : ''
}

async function guard(request: FastifyRequest, reply: FastifyReply) {
  reply.header('Cache-Control', 'no-store')
  if (!getGoogleLoginClientId()) return reply.code(403).send({ error: 'Google 登录未启用' })
  // Only same-origin JS can initiate this flow. Fastify also parses the JSON body.
  if (request.headers['sec-fetch-site'] === 'cross-site'
    || request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
    return reply.code(403).send({ error: '无效的登录请求' })
  }
  if (!(await checkRateLimit(`google-login:${request.ip}`, 20))) {
    return reply.code(429).send({ error: '登录尝试过于频繁，请稍后再试' })
  }
}

export function registerGoogleAuthRoutes(app: FastifyInstance): void {
  app.post('/api/auth/google/challenge', { preHandler: guard, bodyLimit: 1024 }, async (request, reply) => {
    try {
      const nonce = await createGoogleNonce()
      setNonceCookie(request, reply, nonce, GOOGLE_NONCE_TTL_SECONDS)
      return { nonce, expiresIn: GOOGLE_NONCE_TTL_SECONDS }
    } catch {
      return reply.code(503).send({ error: 'Google 登录暂不可用，请稍后重试' })
    }
  })

  app.post('/api/auth/google', { preHandler: guard, bodyLimit: 20_000 }, async (request, reply) => {
    const body = loginSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: '无效的登录请求' })
    try {
      const nonce = readNonceCookie(request)
      if (!(await googleNonceValid(nonce))) throw new GoogleAuthError()
      const identity = await verifyGoogleCredential(body.data.credential, nonce)
      if (!(await checkLoginRateLimit(request.ip, identity.email))) {
        return reply.code(429).send({ error: '登录尝试过于频繁，请稍后再试' })
      }
      const user = await signInGoogleUser({
        identity,
        password: body.data.password,
        registrationEnabled: await isRegistrationEnabled(),
        consumeProof: async () => {
          if (!(await consumeGoogleNonce(nonce))) throw new GoogleAuthError()
        },
      })
      setNonceCookie(request, reply, '', 0)
      const token = app.jwt.sign({ sub: user.id, role: 'user', email: user.email, name: user.name }, { expiresIn: '7d' })
      return { role: 'user', token, user }
    } catch (error) {
      if (error instanceof GoogleLinkRequiredError) {
        return reply.code(error.statusCode).send({ error: error.message, code: 'google_link_required' })
      }
      if (error instanceof GoogleAuthError || error instanceof UserManagerError) {
        return reply.code(error.statusCode).send({ error: error.message })
      }
      return reply.code(503).send({ error: 'Google 登录暂不可用，请稍后重试' })
    }
  })
}
