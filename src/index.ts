import { existsSync } from 'node:fs'
import { join } from 'node:path'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyStatic from '@fastify/static'
import { config } from './config'
import { initDb } from './db/init'
import { ensureAdmin } from './auth/admin'
import { registerAdminRoutes } from './routes/admin'

async function main(): Promise<void> {
  initDb()
  ensureAdmin()

  const app = Fastify({
    logger: true,
    bodyLimit: 32 * 1024 * 1024, // 32 MB — room for large prompts / inline images
  })

  await app.register(fastifyJwt, { secret: config.JWT_SECRET })

  app.get('/health', async () => ({ status: 'ok', service: 'model-bridge' }))

  registerAdminRoutes(app)
  // Relay routes (/api/claude, /api/openai, /api/gemini) are added in Phase B+.

  // Serve the built admin dashboard (web/dist) if it has been built.
  const webDist = join(process.cwd(), 'web', 'dist')
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist })
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api') || request.url.startsWith('/health')) {
        return reply.code(404).send({ error: 'not found' })
      }
      return reply.sendFile('index.html') // SPA history fallback
    })
  } else {
    app.log.warn('web/dist not found — run "npm run build" in web/ to serve the dashboard')
  }

  await app.listen({ port: config.PORT, host: config.HOST })
}

main().catch((err) => {
  console.error('[fatal]', err)
  process.exit(1)
})
