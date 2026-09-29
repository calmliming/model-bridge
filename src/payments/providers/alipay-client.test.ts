import { createSign, createVerify, generateKeyPairSync } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AlipayProvider } from './alipay'
import { AlipayWebProvider } from './alipay-web'

const merchant = generateKeyPairSync('rsa', { modulusLength: 2048 })
const platform = generateKeyPairSync('rsa', { modulusLength: 2048 })
const raw = (pem: string) => pem.replace(/-----[^\n]+-----|\s/g, '')
const privateKey = raw(merchant.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString())
const alipayPublicKey = raw(platform.publicKey.export({ type: 'spki', format: 'pem' }).toString())
let gatewayUrl: string
let response: Record<string, string>
let corruptSignature: boolean
let requestSignatureValid: boolean

const server = createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk.toString()
  const params = new URL(req.url!, 'http://localhost').searchParams
  for (const [key, val] of new URLSearchParams(body)) params.set(key, val)
  if (!params.get('sign') || !params.get('method')) {
    res.writeHead(400).end('Missing signed SDK parameters')
    return
  }
  const signText = [...params.entries()].filter(([key, val]) => key !== 'sign' && val !== '')
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, val]) => `${key}=${val}`).join('&')
  requestSignatureValid = createVerify('RSA-SHA256').update(signText).verify(merchant.publicKey, params.get('sign')!, 'base64')
  const sign = createSign('RSA-SHA256').update(JSON.stringify(response)).sign(platform.privateKey, 'base64')
  const responseKey = params.get('method')!.replaceAll('.', '_') + '_response'
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ [responseKey]: response, sign: corruptSignature ? 'invalid-signature' : sign }))
})

beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  gatewayUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/gateway.do`
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
})
beforeEach(() => {
  corruptSignature = false
  requestSignatureValid = false
  response = {
    code: '10000', msg: 'Success', out_trade_no: 'po_1', trade_no: 'trade_1',
    total_amount: '0.50', trade_status: 'TRADE_SUCCESS', qr_code: 'https://qr.alipay.com/test',
  }
})

function config() {
  return {
    appId: 'app_1', privateKey, alipayPublicKey, sellerId: 'seller_1', sellerEmail: 'seller@example.com',
    usdCnyRate: '1.00', gatewayUrl, returnUrl: 'https://merchant.example/api/payment/return/alipay',
  }
}

function notification(overrides: Record<string, string> = {}) {
  const data: Record<string, string> = {
    app_id: 'app_1', seller_id: 'seller_1', seller_email: 'seller@example.com',
    out_trade_no: 'po_1', trade_no: 'trade_1', total_amount: '0.50', trade_status: 'TRADE_SUCCESS',
    ...overrides,
  }
  const text = Object.keys(data).sort().map(key => `${key}=${data[key]}`).join('&')
  return { ...data, sign_type: 'RSA2', sign: createSign('RSA-SHA256').update(text).sign(platform.privateKey, 'base64') }
}

describe.each([['QR', AlipayProvider], ['web', AlipayWebProvider]] as const)('%s official SDK payment integrity', (_, Provider) => {
  it('accepts correctly signed payments using raw production-style keys', async () => {
    await expect(new Provider(config()).verifyNotification(notification())).resolves.toMatchObject({
      status: 'success', orderId: 'po_1', paidProviderAmount: '0.50',
    })
  })
  it('rejects forged and altered notification signatures', async () => {
    const data = notification()
    await expect(new Provider(config()).verifyNotification({ ...data, total_amount: '100' })).rejects.toThrow(/signature/)
  })
  it.each([
    [{ app_id: 'other-app' }, /app_id/],
    [{ seller_id: 'other-seller' }, /seller/],
    [{ trade_no: '' }, /trade_no/],
    [{ total_amount: '0' }, /total_amount/],
    [{ total_amount: 'NaN' }, /total_amount/],
  ] as const)('rejects signed notifications with invalid business data %j', async (overrides, error) => {
    await expect(new Provider(config()).verifyNotification(notification(overrides))).rejects.toThrow(error)
  })
  it('does not credit refund or unpaid notifications', async () => {
    await expect(new Provider(config()).verifyNotification(notification({ refund_fee: '0.50' }))).resolves.toMatchObject({ status: 'ignored' })
    await expect(new Provider(config()).verifyNotification(notification({ trade_status: 'WAIT_BUYER_PAY' }))).resolves.toMatchObject({ status: 'ignored' })
  })
  it('signs real SDK requests and verifies signed query responses', async () => {
    await expect(new Provider(config()).queryOrder('po_1')).resolves.toMatchObject({ status: 'success', paidProviderAmount: '0.50' })
    expect(requestSignatureValid).toBe(true)
  })
  it('rejects a query response with an invalid platform signature', async () => {
    corruptSignature = true
    await expect(new Provider(config()).queryOrder('po_1')).rejects.toThrow()
  })
  it('rejects a signed query result for another order', async () => {
    response.out_trade_no = 'po_other'
    await expect(new Provider(config()).queryOrder('po_1')).rejects.toThrow(/order does not match/)
  })
})

it('creates a QR checkout with raw keys and verifies the gateway response', async () => {
  await expect(new AlipayProvider(config()).createPayment({
    orderId: 'po_1', amount: 0.5, amountMicros: 500_000, subject: '充值', userId: 'user_1',
  })).resolves.toMatchObject({ providerAmount: '0.50', qrCode: 'https://qr.alipay.com/test' })
  expect(requestSignatureValid).toBe(true)
})
