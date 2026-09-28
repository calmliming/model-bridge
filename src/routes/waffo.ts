import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireUser } from '../middleware/userAuth'
import { createSubscriptionCheckout, getSubscriptionCheckout, applyWaffoEvent } from '../subscriptions/checkout'
import { SubscriptionError } from '../subscriptions/manager'
import { verifyWaffoEvent } from '../payments/providers/waffo'

export async function registerWaffoRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/users/subscriptions/checkout', { preHandler: requireUser }, async (request, reply) => {
    const body = z.object({ planId: z.string().trim().min(1).max(100) }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: '请选择有效套餐' })
    try {
      const checkout = await createSubscriptionCheckout(request.currentUser!, body.data.planId)
      return reply.code(201).send({ checkout })
    } catch (error) {
      if (error instanceof SubscriptionError) return reply.code(error.statusCode).send({ error: error.message })
      throw error
    }
  })
  app.get<{ Params: { id: string } }>('/api/users/subscription-checkouts/:id', { preHandler: requireUser }, async (request, reply) => {
    try { return { checkout: await getSubscriptionCheckout(request.currentUser!.id, request.params.id) } }
    catch (error) {
      if (error instanceof SubscriptionError) return reply.code(error.statusCode).send({ error: error.message })
      throw error
    }
  })
  // Encapsulate the raw parser so other JSON routes retain normal Fastify validation.
  await app.register(async callback => {
    callback.removeContentTypeParser('application/json')
    callback.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 256 * 1024 }, (_request, body, done) => done(null, body))
    callback.post('/api/payment/callback/waffo', { bodyLimit: 256 * 1024 }, async (request, reply) => {
      try {
        const signature = request.headers['x-waffo-signature']
        const event = verifyWaffoEvent(request.body as string, typeof signature === 'string' ? signature : undefined)
        await applyWaffoEvent(event)
        return reply.type('text/plain').send('OK')
      } catch (error) {
        if (error instanceof SubscriptionError) return reply.code(error.statusCode).send({ error: error.message })
        request.log.error({ err: error }, 'Waffo subscription notification failed')
        return reply.code(500).send({ error: '订阅通知处理失败，请重试' })
      }
    })
  })
}
