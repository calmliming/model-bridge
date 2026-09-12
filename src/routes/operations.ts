import type { FastifyInstance } from 'fastify'
import { requireAdmin } from '../middleware/adminAuth'
import { listAccountCatalogs, syncAccountCatalog } from '../accounts/modelCatalog'
import { channelHealth, getHealthSettings, healthQuerySchema, healthSettingsSchema, saveHealthSettings } from '../usage/channelHealth'

export function registerOperationsRoutes(app: FastifyInstance) {
  app.get('/api/admin/model-catalog', { preHandler: requireAdmin }, async () => ({ accounts: await listAccountCatalogs() }))
  app.post('/api/admin/model-catalog/:id/sync', { preHandler: requireAdmin }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    if (!/^[\w-]{1,100}$/.test(id)) return reply.code(400).send({ error: '账号 ID 无效' })
    try { return { catalog: await syncAccountCatalog(id) } }
    catch (error) {
      const message = (error as Error).message
      const known = /^(账号不存在|停用账号不能同步目录|该服务商暂不支持目录同步|同步失败，请检查上游连通性和目录接口|上游返回 HTTP \d{3})$/.test(message)
      return reply.code(400).send({ error: known ? message : '目录同步失败，请稍后重试' })
    }
  })
  app.get('/api/admin/channel-health', { preHandler: requireAdmin }, async (request, reply) => {
    const query = healthQuerySchema.safeParse(request.query)
    if (!query.success) return reply.code(400).send({ error: '筛选条件无效，时间范围须为 1–168 小时' })
    return channelHealth(query.data)
  })
  app.get('/api/admin/channel-health/settings', { preHandler: requireAdmin }, getHealthSettings)
  app.put('/api/admin/channel-health/settings', { preHandler: requireAdmin }, async (request, reply) => {
    const body = healthSettingsSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: '阈值无效，请检查样本数、错误率和延迟' })
    await saveHealthSettings(body.data)
    return body.data
  })
}
