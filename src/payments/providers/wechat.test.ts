import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildWechatXml, parseWechatXml } from '../wechatXml'
import { WechatPayProvider } from './wechat'

const config = { appId: 'wx-review', mchId: 'merchant-review', apiKey: 'test-key', notifyUrl: 'https://example.test/notify' }
const provider = new WechatPayProvider(config)
const sign = (fields: Record<string, string>, apiKey = config.apiKey) => createHash('md5')
  .update(Object.keys(fields).sort().filter(key => key !== 'sign' && fields[key] !== '')
    .map(key => `${key}=${fields[key]}`).join('&') + `&key=${apiKey}`).digest('hex').toUpperCase()
const signedXml = (fields: Record<string, string>) => buildWechatXml({ ...fields, sign: sign(fields) })
const merchant = { appid: config.appId, mch_id: config.mchId, return_code: 'SUCCESS', result_code: 'SUCCESS' }

afterEach(() => vi.unstubAllGlobals())

describe('WeChat Native payments', () => {
  it('creates a payment from a signed single-line XML response and preserves the submitted amount', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(signedXml({ ...merchant, prepay_id: 'prepay-1', code_url: 'weixin://pay/1' })))
    vi.stubGlobal('fetch', fetch)
    expect(await provider.createPayment({ orderId: 'order-1', amount: 10, amountMicros: 10_000_000,
      subject: '充值]]>测试', userId: 'user-1' })).toMatchObject({ providerOrderId: 'prepay-1', qrCode: 'weixin://pay/1',
      providerAmount: '72.00', providerCurrency: 'CNY' })
    const sent = parseWechatXml(fetch.mock.calls[0]![1].body)
    expect(sent).toMatchObject({ total_fee: '7200', body: '充值]]>测试', out_trade_no: 'order-1' })
    expect(sent.sign).toBe(sign(sent))
    expect(fetch.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal)
  })

  it('queries a signed transaction and verifies the returned order and merchant', async () => {
    const fields = { ...merchant, out_trade_no: 'order-1', transaction_id: 'transaction-1', trade_state: 'SUCCESS',
      total_fee: '7200', time_end: '20261014230000' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(signedXml(fields))))
    expect(await provider.queryOrder('order-1')).toMatchObject({ orderId: 'order-1', status: 'success', paidAmount: 10 })
  })

  it('rejects unsigned query results before they can credit a wallet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(buildWechatXml({ ...merchant, out_trade_no: 'order-1',
      trade_state: 'SUCCESS', total_fee: '7200', time_end: '20261014230000' }))))
    await expect(provider.queryOrder('order-1')).rejects.toThrow('signature verification failed')
  })

  it('rejects a validly signed query for a different order', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(signedXml({ ...merchant, out_trade_no: 'order-other' }))))
    await expect(provider.queryOrder('order-1')).rejects.toThrow('different order')
  })

  it('verifies callbacks and rejects a signed payload for another merchant', async () => {
    const fields = { ...merchant, out_trade_no: 'order-1', transaction_id: 'transaction-1', total_fee: '7200', time_end: '20261014230000' }
    expect(await provider.verifyNotification(parseWechatXml(signedXml(fields)))).toMatchObject({ status: 'success', paidAmount: 10 })
    await expect(provider.verifyNotification(parseWechatXml(signedXml({ ...fields, mch_id: 'other-merchant' })))).rejects.toThrow('merchant does not match')
  })
})
