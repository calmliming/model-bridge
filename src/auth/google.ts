import { randomBytes } from 'node:crypto'
import { OAuth2Client } from 'google-auth-library'
import { z } from 'zod'
import { config } from '../config'
import { getRedis } from '../store/redis'

export const GOOGLE_NONCE_TTL_SECONDS = 300
const MAX_PENDING_NONCES = 10_000
const pending = new Map<string, number>()
const client = new OAuth2Client({ transporterOptions: { timeout: 10_000, retry: false } })

export class GoogleAuthError extends Error {
  constructor(message = 'Google 登录已失效，请重新选择 Google 账号', public readonly statusCode = 401) {
    super(message)
  }
}

export function getGoogleLoginClientId(): string | null {
  return config.GOOGLE_LOGIN_CLIENT_ID || null
}

function key(nonce: string): string { return `auth:google:nonce:${nonce}` }

// Redis failures must fail closed; falling back could accept a consumed nonce
// on another replica. The bounded memory store is only for single instances.
export async function createGoogleNonce(): Promise<string> {
  const nonce = randomBytes(32).toString('hex')
  const redis = getRedis()
  if (redis) {
    await redis.set(key(nonce), '1', 'EX', GOOGLE_NONCE_TTL_SECONDS)
  } else {
    const now = Date.now()
    for (const [value, expires] of pending) if (expires <= now) pending.delete(value)
    if (pending.size >= MAX_PENDING_NONCES) throw new GoogleAuthError('登录繁忙，请稍后重试', 503)
    pending.set(nonce, now + GOOGLE_NONCE_TTL_SECONDS * 1000)
  }
  return nonce
}

export async function googleNonceValid(nonce: string): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(nonce)) return false
  const redis = getRedis()
  if (redis) return (await redis.exists(key(nonce))) === 1
  const expires = pending.get(nonce)
  if (expires != null && expires > Date.now()) return true
  pending.delete(nonce)
  return false
}

export async function consumeGoogleNonce(nonce: string): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(nonce)) return false
  const redis = getRedis()
  if (redis) return (await redis.del(key(nonce))) === 1
  const expires = pending.get(nonce)
  pending.delete(nonce)
  return expires != null && expires > Date.now()
}

const identitySchema = z.object({
  sub: z.string().min(1).max(255),
  email: z.string().email().max(320),
  email_verified: z.literal(true),
  name: z.string().optional(),
  nonce: z.string(),
})

export interface GoogleIdentity { sub: string; email: string; name?: string }

export async function verifyGoogleCredential(credential: string, nonce: string): Promise<GoogleIdentity> {
  const audience = getGoogleLoginClientId()
  if (!audience) throw new GoogleAuthError('Google 登录未启用', 403)
  try {
    // The official library checks Google's signature, issuer, audience and expiry,
    // and caches Google's public certificates according to their cache headers.
    const ticket = await client.verifyIdToken({ idToken: credential, audience })
    const result = identitySchema.safeParse(ticket.getPayload())
    if (!result.success || result.data.nonce !== nonce) throw new GoogleAuthError()
    return { sub: result.data.sub, email: result.data.email, name: result.data.name }
  } catch (error) {
    if (error instanceof GoogleAuthError) throw error
    // Never return/log the credential or Google's raw verification response.
    throw new GoogleAuthError('无法验证 Google 登录，请稍后重试')
  }
}
