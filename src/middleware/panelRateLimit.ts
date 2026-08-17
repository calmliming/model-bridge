import { createHash } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import {
  getPanelRateLimitSettings,
  type PanelRateLimitSettings,
} from '../db/settings'
import { checkWindowLimit } from './limits'

const WINDOW_MS = 60_000
const SETTINGS_CACHE_MS = 5_000
const PANEL_PREFIXES = ['/api/admin', '/api/auth', '/api/users', '/api/usage']
const SENSITIVE_WRITE_PATHS = new Set([
  '/api/auth/register',
  '/api/users/invites/accept',
  '/api/users/redeem',
])

let cachedSettings: PanelRateLimitSettings | null = null
let settingsCachedAt = 0

function requestPath(request: FastifyRequest): string {
  return request.url.split('?', 1)[0]
}

export function isPanelRateLimitedPath(path: string): boolean {
  return PANEL_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

export function isSensitivePanelWrite(path: string, method: string): boolean {
  return method.toUpperCase() === 'POST' && SENSITIVE_WRITE_PATHS.has(path)
}

async function currentSettings(): Promise<PanelRateLimitSettings> {
  const now = Date.now()
  if (cachedSettings && now - settingsCachedAt < SETTINGS_CACHE_MS) return cachedSettings
  cachedSettings = await getPanelRateLimitSettings()
  settingsCachedAt = now
  return cachedSettings
}

function hashed(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24)
}

async function authenticatedIdentity(request: FastifyRequest): Promise<string | null> {
  if (!request.headers.authorization?.startsWith('Bearer ')) return null
  try {
    await request.jwtVerify()
    const user = request.user as { sub?: string; role?: string } | undefined
    if (!user?.sub || (user.role !== 'admin' && user.role !== 'user')) return null
    return `${user.role}:${hashed(user.sub)}`
  } catch {
    // Authentication middleware returns the canonical 401 later. Invalid
    // tokens share the IP bucket so forged identities cannot evade limits.
    return null
  }
}

/** Global onRequest hook scoped to dashboard APIs; relay routes are excluded. */
export async function panelRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const path = requestPath(request)
  if (!isPanelRateLimitedPath(path)) return

  const [settings, identity] = await Promise.all([
    currentSettings(),
    authenticatedIdentity(request),
  ])
  const write = isSensitivePanelWrite(path, request.method)
  const limit = write ? settings.write : identity ? settings.authenticated : settings.public
  const dimension = identity ?? `ip:${hashed(request.ip)}`
  const result = await checkWindowLimit(`panel:${write ? 'write' : 'read'}:${dimension}`, limit, WINDOW_MS)
  if (result.allowed) return

  const retryAfter = Math.max(1, Math.ceil(result.retryAfterMs / 1000))
  reply.header('Retry-After', String(retryAfter))
  await reply.code(429).send({ error: '请求过于频繁，请稍后再试', retryAfter })
}

/** Test/settings helper: forces the next request to reload database settings. */
export function resetPanelRateLimitSettingsCache(): void {
  cachedSettings = null
  settingsCachedAt = 0
}
