import { existsSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyStatic from '@fastify/static'
import { config } from './config'
import { pool } from './db/index'
import { initDb } from './db/init'
import { initPricing } from './usage/pricing'
import { ensureAdmin } from './auth/admin'
import { registerAuthRoutes } from './routes/auth'
import { registerAdminRoutes } from './routes/admin'
import { registerUserRoutes } from './routes/users'
import { registerRelayRoutes } from './routes/relay'
import { registerUsageRoutes } from './routes/usage'
import { registerPaymentCallbackRoutes } from './routes/payment-callback'
import { registerSecurityHeaders } from './middleware/securityHeaders'
import { startTokenRefreshJob } from './jobs/tokenRefresh'
import { startQuotaAutopauseJob } from './jobs/quotaAutopause'
import { closeOauthCallbackServer, startOauthCallbackServer } from './oauthCallback'
import { initPaymentProviders } from './payments/providers/index'
import { closeRedis } from './store/redis'
import { waitForPendingUsage } from './usage/recorder'
import { TRUSTED_LOCAL_PROXIES } from './http/trustProxy'

const SHUTDOWN_TIMEOUT_MS = 30_000

async function main(): Promise<void> {
  await initDb()
  await initPricing()
  await ensureAdmin()

  // 初始化支付提供商
  initPaymentProviders({
    alipay:
      config.ALIPAY_APP_ID &&
      config.ALIPAY_PRIVATE_KEY &&
      config.ALIPAY_PUBLIC_KEY &&
      config.ALIPAY_NOTIFY_URL &&
      config.ALIPAY_RETURN_URL
        ? {
            appId: config.ALIPAY_APP_ID,
            privateKey: config.ALIPAY_PRIVATE_KEY,
            alipayPublicKey: config.ALIPAY_PUBLIC_KEY,
            notifyUrl: config.ALIPAY_NOTIFY_URL,
            returnUrl: config.ALIPAY_RETURN_URL,
          }
        : undefined,
    wechat:
      config.WECHAT_APP_ID && config.WECHAT_MCH_ID && config.WECHAT_API_KEY && config.WECHAT_NOTIFY_URL
        ? {
            appId: config.WECHAT_APP_ID,
            mchId: config.WECHAT_MCH_ID,
            apiKey: config.WECHAT_API_KEY,
            notifyUrl: config.WECHAT_NOTIFY_URL,
          }
        : undefined,
  })

  const app = Fastify({
    logger: true,
    bodyLimit: 32 * 1024 * 1024, // 32 MB — room for large prompts / inline images
    trustProxy: TRUSTED_LOCAL_PROXIES,
  })

  let stopTokenRefreshJob: () => Promise<void> = async () => {}
  let stopQuotaAutopauseJob: () => Promise<void> = async () => {}
  let oauthCallbackServer: Server | null = null

  app.addHook('onClose', async () => {
    await Promise.all([stopTokenRefreshJob(), stopQuotaAutopauseJob()])
    await closeOauthCallbackServer(oauthCallbackServer)
    await waitForPendingUsage()
    await closeRedis()
    await pool.end()
  })

  await app.register(fastifyJwt, { secret: config.JWT_SECRET })
  registerSecurityHeaders(app)

  app.get('/health', async () => ({ status: 'ok', service: 'model-bridge' }))

  registerAuthRoutes(app)
  registerAdminRoutes(app)
  registerUserRoutes(app)
  registerRelayRoutes(app)
  registerUsageRoutes(app)
  registerPaymentCallbackRoutes(app)

  // Serve the built admin dashboard (web/dist) if it has been built.
  const webDist = join(process.cwd(), 'web', 'dist')
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist })
    app.setNotFoundHandler((request, reply) => {
      if (
        request.url.startsWith('/api') ||
        request.url.startsWith('/v1') ||
        request.url.startsWith('/v1beta') ||
        request.url.startsWith('/health')
      ) {
        return reply.code(404).send({ error: 'not found' })
      }
      return reply.sendFile('index.html') // SPA history fallback
    })
  } else {
    app.log.warn('web/dist not found — run "npm run build" in web/ to serve the dashboard')
  }

  await app.listen({ port: config.PORT, host: config.HOST })
  app.log.info({ trustedProxies: TRUSTED_LOCAL_PROXIES }, 'local proxy forwarding enabled')
  stopTokenRefreshJob = startTokenRefreshJob()
  stopQuotaAutopauseJob = startQuotaAutopauseJob()
  // OpenAI's OAuth public client only allows http://localhost:1455/auth/callback
  // as a redirect URI, so we run a small dedicated listener on 1455.
  oauthCallbackServer = startOauthCallbackServer()

  let shuttingDown = false
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return
    shuttingDown = true
    app.log.info({ signal }, 'shutdown requested; draining in-flight requests and usage writes')
    const forceExit = setTimeout(() => {
      app.log.error({ signal }, 'graceful shutdown timed out')
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS)
    forceExit.unref()

    try {
      await app.close()
      clearTimeout(forceExit)
      app.log.info('graceful shutdown complete')
    } catch (err) {
      app.log.error({ err }, 'graceful shutdown failed')
      process.exitCode = 1
    }
  }
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
  process.once('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((err) => {
  console.error('[fatal]', err)
  process.exit(1)
})
