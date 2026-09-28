import { generateKeyPairSync, createHash, sign, verify } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  config: { WAFFO_MODE: 'test', WAFFO_STORE_ID: 'STO_test', WAFFO_MERCHANT_ID: 'MER_test', WAFFO_PRIVATE_KEY: '', WAFFO_WEBHOOK_PUBLIC_KEY: '', WAFFO_SUCCESS_URL: 'https://bridge.example/app' },
}))
vi.mock('../../config', () => ({ config: mocks.config }))
vi.mock('../../http/upstream', () => ({ fetchWithConnectTimeout: mocks.fetch }))
vi.mock('../../db/index', () => ({ pool: {} }))
import { createWaffoSession, signWaffoRequest, verifyWaffoEvent, safeWaffoCheckoutUrl } from './waffo'

const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})
const event = () => ({ id: 'ORD_1', eventId: 'ORD_1', eventType: 'subscription.activated', timestamp: new Date().toISOString(), storeId: 'STO_test', mode: 'test', data: { orderId: 'ORD_1', currency: 'USD' } })
const header = (body: string, time = Date.now()) => `t=${time},v1=${sign('RSA-SHA256', Buffer.from(`${time}.${body}`), keys.privateKey).toString('base64')}`
beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(mocks.config, { WAFFO_MODE: 'test', WAFFO_PRIVATE_KEY: keys.privateKey, WAFFO_WEBHOOK_PUBLIC_KEY: keys.publicKey })
})

describe('Waffo authentication and checkout', () => {
  it('signs the documented path, seconds timestamp and SHA256 body hash', () => {
    const body = '{"price":10}'
    const timestamp = '1790500000'
    const signature = signWaffoRequest(body, keys.privateKey.replace(/\n/g, '\\n'), timestamp)
    const canonical = `POST\n/v1/actions/checkout/create-session\n${timestamp}\n${createHash('sha256').update(body).digest('base64')}`
    expect(verify('RSA-SHA256', Buffer.from(canonical), keys.publicKey, Buffer.from(signature, 'base64'))).toBe(true)
  })
  it('creates a priced monthly checkout with server-bound metadata and no trial', async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ data: { sessionId: 'cs_1', checkoutUrl: 'https://pancake.waffo.ai/store/test/checkout/cs_1', expiresAt: new Date(Date.now() + 1800_000).toISOString() } })))
    const session = await createWaffoSession({ checkoutId: 'sc_1', planId: 'plan_lite', productId: 'PROD_lite', price: 10, email: 'buyer@example.com' })
    expect(session.checkoutUrl).toContain('?test=true')
    const [, request] = mocks.fetch.mock.calls[0]
    expect(JSON.parse(request.body)).toMatchObject({
      productId: 'PROD_lite', currency: 'USD', withTrial: false,
      orderMerchantExternalId: 'sc_1', metadata: { checkoutId: 'sc_1', planId: 'plan_lite', productId: 'PROD_lite' },
      priceSnapshot: { amount: '10.00', taxIncluded: false, taxCategory: 'saas' },
    })
    expect(request.headers['X-Merchant-Id']).toBe('MER_test')
  })
  it.each(['http://pancake.waffo.ai/x', 'https://waffo.ai.evil.example/x', 'https://pancake.waffo.ai@evil.example/x', 'https://pancake.waffo.ai:8443/x', 'javascript:alert(1)'])('rejects unsafe checkout address %s', url => {
    expect(() => safeWaffoCheckoutUrl(url, 'test')).toThrow()
  })
  it('fails closed before contacting Waffo when configuration is absent', async () => {
    mocks.config.WAFFO_WEBHOOK_PUBLIC_KEY = ''
    await expect(createWaffoSession({ checkoutId: 'sc_1', planId: 'p', productId: 'PROD_1', price: 10, email: 'a@example.com' })).rejects.toMatchObject({ statusCode: 503 })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})

describe('Waffo raw webhook verification', () => {
  it('accepts a valid raw body, including a legitimate 31-minute retry', () => {
    const body = JSON.stringify(event(), null, 2)
    expect(verifyWaffoEvent(body, header(body, Date.now() - 31 * 60_000)).eventType).toBe('subscription.activated')
  })
  it('rejects JSON reserialization and forged signatures', () => {
    const body = JSON.stringify(event(), null, 2)
    expect(() => verifyWaffoEvent(JSON.stringify(JSON.parse(body)), header(body))).toThrow('签名')
    expect(() => verifyWaffoEvent(body, `t=${Date.now()},v1=Zm9yZ2Vk`)).toThrow('签名')
  })
  it('rejects stale, future, nonnumeric and missing timestamps', () => {
    const body = JSON.stringify(event())
    for (const time of [Date.now() - 46 * 60_000, Date.now() + 46 * 60_000]) expect(() => verifyWaffoEvent(body, header(body, time))).toThrow('签名')
    expect(() => verifyWaffoEvent(body, 't=NaN,v1=aaa')).toThrow('签名')
    expect(() => verifyWaffoEvent(body, undefined)).toThrow('签名')
  })
  it('rejects test notifications in production and other merchant stores', () => {
    const body = JSON.stringify(event())
    mocks.config.WAFFO_MODE = 'prod'
    expect(() => verifyWaffoEvent(body, header(body))).toThrow('环境或商店')
    mocks.config.WAFFO_MODE = 'test'
    const other = JSON.stringify({ ...event(), storeId: 'STO_other' })
    expect(() => verifyWaffoEvent(other, header(other))).toThrow('环境或商店')
  })
})
