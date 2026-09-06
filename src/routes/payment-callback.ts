import type { FastifyInstance } from 'fastify'
import { handlePaymentNotification, queryPaymentOrder } from '../payments/manager'
import { getPaymentProvider } from '../payments/providers/index'

function paymentReturnHtml(title: string, message: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body><main><h1>${title}</h1><p>${message}</p><p><a href="/app">返回账户中心</a></p></main></body>
</html>`
}

/**
 * 支付回调路由
 * 这些路由不需要认证，由支付平台直接调用
 */
export function registerPaymentCallbackRoutes(app: FastifyInstance): void {
  // 支付宝网站支付同步回跳。同步参数只用于定位，经 SDK 验签后仍主动查询交易状态。
  app.get('/api/payment/return/alipay', async (request, reply) => {
    const data = request.query as Record<string, unknown>
    const orderId = typeof data.out_trade_no === 'string' ? data.out_trade_no.trim() : ''
    if (!orderId) {
      return reply
        .type('text/html; charset=utf-8')
        .send(paymentReturnHtml('正在确认支付结果', '未发现订单上下文，请返回账户中心查看订单状态。'))
    }
    const provider = getPaymentProvider('alipay_web')
    if (!provider?.verifyReturn || !provider.verifyReturn(data)) {
      return reply
        .code(400)
        .type('text/html; charset=utf-8')
        .send(paymentReturnHtml('支付结果校验失败', '回跳参数未通过验签，请返回账户中心并主动刷新订单。'))
    }
    try {
      const order = await queryPaymentOrder({ id: orderId })
      const message = order.status === 'paid'
        ? '支付已确认，充值金额已经到账。'
        : order.status === 'pending'
          ? '支付宝尚未确认付款，请稍后返回账户中心刷新订单。'
          : '订单当前不是可支付状态，请返回账户中心查看详情。'
      return reply
        .type('text/html; charset=utf-8')
        .send(paymentReturnHtml('支付结果', message))
    } catch (err) {
      app.log.warn({ err }, 'Alipay return query failed')
      return reply
        .code(502)
        .type('text/html; charset=utf-8')
        .send(paymentReturnHtml('正在确认支付结果', '交易查询暂时不可用，请返回账户中心稍后刷新。'))
    }
  })

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
