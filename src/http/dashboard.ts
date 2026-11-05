import { existsSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'

/** Register before the relay routes so browser navigation runs before API authentication. */
export async function registerDashboardRoutes(app: FastifyInstance, webDist: string): Promise<void> {
  if (!existsSync(webDist)) {
    app.log.warn('web/dist not found — run "npm run build" in web/ to serve the dashboard')
    return
  }

  app.addHook('onRequest', async (request, reply) => {
    if (
      (request.method !== 'GET' && request.method !== 'HEAD') ||
      request.url.split('?', 1)[0] !== '/models'
    ) return

    // The same URL serves HTML navigation and authenticated JSON API requests.
    reply.header('Vary', 'Accept')
    if (request.headers.accept?.includes('text/html')) {
      return reply.sendFile('index.html')
    }
  })

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
}
