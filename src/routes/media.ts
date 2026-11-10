import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { requireApiKey, requireApiKeyForResult } from '../middleware/apiKeyAuth'
import { requireStudioSession, studioScopes } from '../middleware/studioAuth'
import { checkRateLimit } from '../middleware/limits'
import { accountAvailability, pickAccount, unavailableAccountMessage } from '../accounts/scheduler'
import { isAllowedModel, isGroupModelAllowed } from '../keys/modelAllowlist'
import { mapRequestedModel } from '../keys/modelMapping'
import { parseGrsaiGenerateRequest } from '../providers/grsai/client'
import { ProviderRequestError } from '../providers/requestError'
import { createMediaTask, getMediaTask, getMediaTaskForUser, MediaTaskError, publicMediaTask, refreshMediaTask, type MediaTask } from '../media/tasks'
import { publicMediaError, publicProviderLabel } from '../providers/publicIdentity'
import { registerStudioFileRoute, withStudioFiles } from '../media/studioFiles'

export function registerMediaRoutes(app: FastifyInstance): void {
  type Kind = MediaTask['kind']
  const generate = (kind?: Kind, studio = false) => async (request: FastifyRequest, reply: FastifyReply) => {
    const key = request.apiKey!
    if (key.allowedProviders && !key.allowedProviders.includes('grsai')) return reply.code(403).send({ error: 'this API key may not use image or video generation' })
    try {
      const raw = request.body as Record<string, unknown> | null
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ProviderRequestError('invalid_media_request', 'request body must be an object')
      const requested = typeof raw.model === 'string' ? raw.model : kind === 'video' ? 'minimax-h3' : ''
      const model = mapRequestedModel(requested, key.modelMappings)
      const body = parseGrsaiGenerateRequest({ ...raw, model })
      if (kind === 'video' && model !== 'minimax-h3') throw new ProviderRequestError('invalid_video_model', 'videos endpoint requires minimax-h3')
      if (kind === 'image' && model === 'minimax-h3') throw new ProviderRequestError('invalid_image_model', 'image tasks require an image model')
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
      const status = !studio && (task.status === 'failed' || task.status === 'violation') ? 502 : 202
      return reply.code(status).send(publicMediaTask(task, studio))
    } catch (error) {
      if (error instanceof ProviderRequestError || error instanceof MediaTaskError) return reply.code(error.statusCode).send({ error: publicMediaError(error.message) })
      request.log.error('media task submission failed')
      return reply.code(503).send({ error: '生成任务暂不可用，请稍后重试' })
    }
  }
  const result = (studioKind?: Kind) => async (request: FastifyRequest, reply: FastifyReply) => {
    const key = request.apiKey!
    if (key.allowedProviders && !key.allowedProviders.includes('grsai')) return reply.code(403).send({ error: 'this API key may not use image or video generation' })
    const id = (request.params as { id?: string }).id ?? (request.query as { id?: string }).id
    if (typeof id !== 'string' || !/^media_[\w-]{1,100}$/.test(id)) return reply.code(400).send({ error: 'invalid media task id' })
    if (!await checkRateLimit(`media-result:${key.id}`, key.rateLimit ?? 120)) return reply.code(429).send({ error: 'result query rate limit exceeded' })
    const task = studioKind ? await getMediaTaskForUser(id, key.userId!) : await getMediaTask(id, key.id)
    if (!task || (studioKind && task.kind !== studioKind)) return reply.code(404).send({ error: 'task not found' })
    if (!isGroupModelAllowed(task.model, key.groupAllowedModels) || (!isAllowedModel(task.requested_model, key.allowedModels) && !isAllowedModel(task.model, key.allowedModels))) {
      return reply.code(403).send({ error: 'model is not allowed' })
    }
    try { return publicMediaTask(await refreshMediaTask(task), !!studioKind) }
    catch (error) {
      if (error instanceof MediaTaskError) return reply.code(error.statusCode).send({ error: publicMediaError(error.message), id })
      return reply.code(503).send({ error: '查询暂不可用，请稍后查询同一任务', id })
    }
  }
  const studioVideoResult = withStudioFiles('video')
  for (const prefix of ['', '/api/media', '/api/grsai']) {
    const studioOptions = prefix === '/api/media' ? { onSend: studioVideoResult } : {}
    app.post(`${prefix}/v1/videos`, { preHandler: requireApiKey, bodyLimit: 64 * 1024 * 1024, ...studioOptions }, generate('video'))
    app.get(`${prefix}/v1/videos/:id`, { preHandler: requireApiKeyForResult, ...studioOptions }, result())
    app.post(`${prefix}/v1/api/generate`, { preHandler: requireApiKey, bodyLimit: 64 * 1024 * 1024 }, generate())
    app.get(`${prefix}/v1/api/result`, { preHandler: requireApiKeyForResult }, result())
  }
  const studioImageResult = withStudioFiles('image', 'results')
  for (const { prefix, admin } of studioScopes) {
    const submit = { preHandler: requireStudioSession(admin), bodyLimit: 64 * 1024 * 1024 }
    const query = { preHandler: requireStudioSession(admin, true) }
    app.post(`${prefix}/image-tasks`, { ...submit, onSend: studioImageResult }, generate('image', true))
    app.get(`${prefix}/image-tasks/:id`, { ...query, onSend: studioImageResult }, result('image'))
    app.post(`${prefix}/videos`, { ...submit, onSend: studioVideoResult }, generate('video', true))
    app.get(`${prefix}/videos/:id`, { ...query, onSend: studioVideoResult }, result('video'))
  }
  registerStudioFileRoute(app)
}
