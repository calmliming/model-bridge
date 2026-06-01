import type { FastifyInstance } from 'fastify'
import { handlePaymentNotification } from '../payments/manager'

/**
 * 支付回调路由
 * 这些路由不需要认证，由支付平台直接调用
 */
export function registerPaymentCallbackRoutes(app: FastifyInstance): void {
  // 支付宝回调
  app.post('/api/payment/callback/alipay', async (request, reply) => {
    try {
      const data = request.body as Record<string, unknown>
      const result = await handlePaymentNotification({
        provider: 'alipay',
        data,
      })

      if (result.success) {
        return reply.type('text/plain').send('success')
      } else {
        return reply.code(400).type('text/plain').send('fail')
      }
    } catch (err) {
      app.log.error({ err }, 'Alipay callback error')
      return reply.code(400).type('text/plain').send('fail')
    }
  })

  // 微信支付回调
  app.post('/api/payment/callback/wechat', async (request, reply) => {
    try {
      // 微信支付回调是 XML 格式，需要解析
      const xmlData = request.body as string
      const data = parseWechatXml(xmlData)

      const result = await handlePaymentNotification({
        provider: 'wechat',
        data,
      })

      if (result.success) {
        return reply.type('application/xml').send('<xml><return_code><![CDATA[SUCCESS]]></return_code><return_msg><![CDATA[OK]]></return_msg></xml>')
      } else {
        return reply.type('application/xml').send('<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[处理失败]]></return_msg></xml>')
      }
    } catch (err) {
      app.log.error({ err }, 'WeChat Pay callback error')
      return reply.type('application/xml').send('<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[系统错误]]></return_msg></xml>')
    }
  })
}

function parseWechatXml(xml: string): Record<string, string> {
  const result: Record<string, string> = {}
  const regex = /<(\w+)>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/\1>/g
  let match

  while ((match = regex.exec(xml)) !== null) {
    result[match[1]!] = match[2]!
  }

  return result
}
