import { existsSync } from 'node:fs'
import { join } from 'node:path'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyStatic from '@fastify/static'
import { config } from './config'
import { initDb } from './db/init'
import { initPricing } from './usage/pricing'
import { ensureAdmin } from './auth/admin'
import { registerAuthRoutes } from './routes/auth'
import { registerAdminRoutes } from './routes/admin'
import { registerUserRoutes } from './routes/users'
import { registerRelayRoutes } from './routes/relay'
import { startTokenRefreshJob } from './jobs/tokenRefresh'
import { startOauthCallbackServer } from './oauthCallback'

async function main(): Promise<void> {
  await initDb()
  await initPricing()
  await ensureAdmin()

  const app = Fastify({
    logger: true,
    bodyLimit: 32 * 1024 * 1024, // 32 MB — room for large prompts / inline images
  })

  await app.register(fastifyJwt, { secret: config.JWT_SECRET })

  app.get('/health', async () => ({ status: 'ok', service: 'model-bridge' }))

  registerAuthRoutes(app)
  registerAdminRoutes(app)
  registerUserRoutes(app)
  registerRelayRoutes(app)

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
  startTokenRefreshJob()
  // OpenAI's OAuth public client only allows http://localhost:1455/auth/callback
  // as a redirect URI, so we run a small dedicated listener on 1455.
  startOauthCallbackServer()
}

main().catch((err) => {
  console.error('[fatal]', err)
  process.exit(1)
})
