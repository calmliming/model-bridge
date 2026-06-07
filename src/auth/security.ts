import { createHash } from 'node:crypto'
import { config } from '../config'
import { checkRateLimit } from '../middleware/limits'

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const TURNSTILE_TIMEOUT_MS = 8000
const LOGIN_RATE_LIMIT = 10

interface TurnstileSiteverifyResponse {
  success?: boolean
  'error-codes'?: string[]
}

export function turnstileEnabled(): boolean {
  return !!(config.TURNSTILE_SITE_KEY && config.TURNSTILE_SECRET_KEY)
}

export function getTurnstileSiteKey(): string | null {
  return turnstileEnabled() ? config.TURNSTILE_SITE_KEY! : null
}

export async function verifyTurnstileToken(
  token: string | undefined,
  remoteIp?: string,
): Promise<boolean> {
  if (!turnstileEnabled()) return true
  if (!token || token.length > 4096) return false

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TURNSTILE_TIMEOUT_MS)
  try {
    const body = new URLSearchParams({
      secret: config.TURNSTILE_SECRET_KEY!,
      response: token,
    })
    if (remoteIp) body.set('remoteip', remoteIp)
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    })
    if (!response.ok) return false
    const result = (await response.json()) as TurnstileSiteverifyResponse
    return result.success === true
  } catch (err) {
    console.warn('[auth] turnstile verification failed:', err instanceof Error ? err.message : 'unknown error')
    return false
  } finally {
    clearTimeout(timer)
  }
}

export async function checkLoginRateLimit(ip: string, account: string): Promise<boolean> {
  const normalized = account.trim().toLowerCase()
  const accountHash = createHash('sha256').update(normalized).digest('hex').slice(0, 16)
  return checkRateLimit(`login:${ip}:${accountHash}`, LOGIN_RATE_LIMIT)
}
