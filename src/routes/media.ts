import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { requireApiKey, requireApiKeyForResult } from '../middleware/apiKeyAuth'
import { checkRateLimit } from '../middleware/limits'
import { accountAvailability, pickAccount, unavailableAccountMessage } from '../accounts/scheduler'
import { isAllowedModel, isGroupModelAllowed } from '../keys/modelAllowlist'
import { mapRequestedModel } from '../keys/modelMapping'
import { parseGrsaiGenerateRequest } from '../providers/grsai/client'
import { ProviderRequestError } from '../providers/requestError'
import { createMediaTask, getMediaTask, MediaTaskError, publicMediaTask, refreshMediaTask } from '../media/tasks'
import { publicMediaError, publicProviderLabel } from '../providers/publicIdentity'

export function registerMediaRoutes(app: FastifyInstance): void {
  const generate = (videoOnly: boolean) => async (request: FastifyRequest, reply: FastifyReply) => {
    const key = request.apiKey!
    if (key.allowedProviders && !key.allowedProviders.includes('grsai')) return reply.code(403).send({ error: 'this API key may not use image or video generation' })
    try {
      const raw = request.body as Record<string, unknown> | null
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ProviderRequestError('invalid_media_request', 'request body must be an object')
      const requested = typeof raw.model === 'string' ? raw.model : videoOnly ? 'minimax-h3' : ''
      const model = mapRequestedModel(requested, key.modelMappings)
      const body = parseGrsaiGenerateRequest({ ...raw, model })
      if (videoOnly && model !== 'minimax-h3') throw new ProviderRequestError('invalid_video_model', 'videos endpoint requires minimax-h3')
      if (body.replyType && body.replyType !== 'async') throw new ProviderRequestError('invalid_reply_type', 'task endpoints support replyType=async; use images/generations for synchronous images')
      if (!isAllowedModel(requested, key.allowedModels) && !isAllowedModel(model, key.allowedModels)) return reply.code(403).send({ error: 'model is not allowed' })
      if (!isGroupModelAllowed(model, key.groupAllowedModels)) return reply.code(403).send({ error: 'model is not allowed in this group' })
      if (key.rateLimit != null && !await checkRateLimit(key.id, key.rateLimit)) return reply.code(429).send({ error: 'rate limit exceeded' })
      const account = await pickAccount('grsai', [], null, key.accountGroupId, model)
      if (!account) {
        // State the real reason (empty pool / cooling down / disabled) instead of
        // a generic "unavailable", which operators read as a missing account.
        const available = await accountAvailability('grsai', [], model, key.accountGroupId ?? null)
        return reply.code(503).send({
          error: publicMediaError(unavailableAccountMessage(publicProviderLabel('grsai'), available, 0)),
        })
      }
      const task = await createMediaTask(key, account, body, requested)
      return reply.code(task.status === 'failed' || task.status === 'violation' ? 502 : 202).send(publicMediaTask(task))
    } catch (error) {
      if (error instanceof ProviderRequestError || error instanceof MediaTaskError) return reply.code(error.statusCode).send({ error: publicMediaError(error.message) })
      request.log.error('media task submission failed')
      return reply.code(503).send({ error: '生成任务暂不可用，请稍后重试' })
    }
  }
  const result = async (request: FastifyRequest, reply: FastifyReply) => {
    const key = request.apiKey!
    if (key.allowedProviders && !key.allowedProviders.includes('grsai')) return reply.code(403).send({ error: 'this API key may not use image or video generation' })
    const id = (request.params as { id?: string }).id ?? (request.query as { id?: string }).id
    if (typeof id !== 'string' || !/^media_[\w-]{1,100}$/.test(id)) return reply.code(400).send({ error: 'invalid media task id' })
    if (!await checkRateLimit(`media-result:${key.id}`, key.rateLimit ?? 120)) return reply.code(429).send({ error: 'result query rate limit exceeded' })
    const task = await getMediaTask(id, key.id)
    if (!task) return reply.code(404).send({ error: 'task not found' })
    if (!isGroupModelAllowed(task.model, key.groupAllowedModels) || (!isAllowedModel(task.requested_model, key.allowedModels) && !isAllowedModel(task.model, key.allowedModels))) {
      return reply.code(403).send({ error: 'model is not allowed' })
    }
    try { return publicMediaTask(await refreshMediaTask(task)) }
    catch (error) {
      if (error instanceof MediaTaskError) return reply.code(error.statusCode).send({ error: publicMediaError(error.message), id })
      return reply.code(503).send({ error: '查询暂不可用，请稍后查询同一任务', id })
    }
  }
  for (const prefix of ['', '/api/media', '/api/grsai']) {
    app.post(`${prefix}/v1/videos`, { preHandler: requireApiKey, bodyLimit: 64 * 1024 * 1024 }, generate(true))
    app.get(`${prefix}/v1/videos/:id`, { preHandler: requireApiKeyForResult }, result)
    app.post(`${prefix}/v1/api/generate`, { preHandler: requireApiKey, bodyLimit: 64 * 1024 * 1024 }, generate(false))
    app.get(`${prefix}/v1/api/result`, { preHandler: requireApiKeyForResult }, result)
  }
}
