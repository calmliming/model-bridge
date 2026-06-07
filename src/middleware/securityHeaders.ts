import type { FastifyInstance } from 'fastify'
import { config } from '../config'
import { turnstileEnabled } from '../auth/security'

const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com'

function contentSecurityPolicy(): string {
  const scriptSrc = ["'self'"]
  const frameSrc = ["'self'"]
  if (turnstileEnabled()) {
    scriptSrc.push(TURNSTILE_ORIGIN)
    frameSrc.push(TURNSTILE_ORIGIN)
  }
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src ${scriptSrc.join(' ')}`,
    `frame-src ${frameSrc.join(' ')}`,
    "connect-src 'self'",
  ].join('; ')
}

export function registerSecurityHeaders(app: FastifyInstance): void {
  if (!config.SECURITY_HEADERS_ENABLED) return
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Content-Security-Policy', contentSecurityPolicy())
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'no-referrer')
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  })
}
