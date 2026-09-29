import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { parseAlipayProductionConfig } from './alipay-production'

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
const privateKey = keys.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const env = {
  ALIPAY_APP_ID: '2026092800000001', ALIPAY_PRIVATE_KEY: privateKey, ALIPAY_PUBLIC_KEY: publicKey,
  ALIPAY_SELLER_ID: '2088000000000001', ALIPAY_PAYMENT_MODE: 'web',
  ALIPAY_NOTIFY_URL: 'https://merchant.example/api/payment/callback/alipay',
  ALIPAY_RETURN_URL: 'https://merchant.example/api/payment/return/alipay',
}
const rawKey = (pem: string) => pem.replace(/-----[^\n]+-----|\s/g, '')

describe('production Alipay configuration', () => {
  it('leaves payment disabled when credentials are absent', () => {
    expect(parseAlipayProductionConfig({})).toBeUndefined()
  })
  it('loads the official gateway and explicit payment product', () => {
    expect(parseAlipayProductionConfig(env)).toMatchObject({
      appId: env.ALIPAY_APP_ID, paymentMode: 'web', keyType: 'PKCS1',
      gatewayUrl: 'https://openapi.alipay.com/gateway.do', usdCnyRate: '7.20',
    })
  })
  it.each(['ALIPAY_APP_ID', 'ALIPAY_PRIVATE_KEY', 'ALIPAY_PUBLIC_KEY', 'ALIPAY_SELLER_ID', 'ALIPAY_NOTIFY_URL', 'ALIPAY_RETURN_URL'])(
    'rejects incomplete production setup missing %s', field => {
      expect(() => parseAlipayProductionConfig({ ...env, [field]: '' })).toThrow(/ALIPAY_/)
    },
  )
  it('supports QR-only without a synchronous return URL', () => {
    expect(parseAlipayProductionConfig({ ...env, ALIPAY_PAYMENT_MODE: 'qr', ALIPAY_RETURN_URL: '' }))
      .toMatchObject({ paymentMode: 'qr', returnUrl: undefined })
  })
  it.each([
    'http://merchant.example/api/payment/callback/alipay',
    'https://localhost/api/payment/callback/alipay',
    'https://127.0.0.1/api/payment/callback/alipay',
    'https://merchant.example/payment/return',
    'https://merchant.example/api/payment/callback/alipay?token=secret',
  ])('rejects invalid notification URL %s', url => {
    expect(() => parseAlipayProductionConfig({ ...env, ALIPAY_NOTIFY_URL: url })).toThrow(/ALIPAY_NOTIFY_URL/)
  })
  it('rejects sandbox or arbitrary gateways in production', () => {
    expect(() => parseAlipayProductionConfig({ ...env, ALIPAY_GATEWAY: 'https://openapi-sandbox.dl.alipaydev.com/gateway.do' })).toThrow(/ALIPAY_GATEWAY/)
  })
  it.each(['PKCS1', 'PKCS8'] as const)('accepts raw %s keys with their declared format', type => {
    const key = keys.privateKey.export({ type: type === 'PKCS1' ? 'pkcs1' : 'pkcs8', format: 'pem' }).toString()
    expect(parseAlipayProductionConfig({ ...env, ALIPAY_PRIVATE_KEY: rawKey(key), ALIPAY_PUBLIC_KEY: rawKey(publicKey), ALIPAY_KEY_TYPE: type }))
      .toMatchObject({ keyType: type })
  })
  it('detects PKCS8 PEM and supports escaped newlines', () => {
    const key = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    expect(parseAlipayProductionConfig({ ...env, ALIPAY_PRIVATE_KEY: key.replaceAll('\n', '\\n') })).toMatchObject({ keyType: 'PKCS8' })
  })
  it('rejects invalid key material without including it in errors', () => {
    expect(() => parseAlipayProductionConfig({ ...env, ALIPAY_PRIVATE_KEY: 'secret-invalid-key' })).toThrow(/ALIPAY_PRIVATE_KEY must/)
    expect(() => parseAlipayProductionConfig({ ...env, ALIPAY_PRIVATE_KEY: 'secret-invalid-key' })).not.toThrow(/secret-invalid-key/)
    expect(() => parseAlipayProductionConfig({ ...env, ALIPAY_KEY_TYPE: 'PKCS8' })).toThrow(/PEM header/)
    expect(() => parseAlipayProductionConfig({ ...env, ALIPAY_PUBLIC_KEY: privateKey })).toThrow(/ALIPAY_PUBLIC_KEY must/)
  })
  it('reads mounted key files and rejects ambiguous inline/file settings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'alipay-config-test-'))
    try {
      const path = join(dir, 'private.pem')
      writeFileSync(path, privateKey)
      expect(parseAlipayProductionConfig({ ...env, ALIPAY_PRIVATE_KEY: '', ALIPAY_PRIVATE_KEY_FILE: path })?.privateKey === privateKey.trim()).toBe(true)
      expect(() => parseAlipayProductionConfig({ ...env, ALIPAY_PRIVATE_KEY_FILE: path })).toThrow(/only one/)
    } finally { unlinkSync(join(dir, 'private.pem')); rmdirSync(dir) }
  })
  it('checks an explicit env file in isolation without printing private keys', () => {
    const dir = mkdtempSync(join(tmpdir(), 'alipay-preflight-test-'))
    const path = join(dir, '.env')
    try {
      writeFileSync(path, Object.entries({ ...env, ALIPAY_ENV: 'production' })
        .map(([key, val]) => `${key}=${JSON.stringify(val)}`).join('\n'))
      const output = execFileSync(process.execPath, [
        'node_modules/tsx/dist/cli.mjs', 'scripts/alipay-production-check.ts', '--env-file', path,
      ], { encoding: 'utf8', env: { ...process.env, ALIPAY_ENV: 'sandbox' } })
      expect(output).toContain('本地配置检查通过')
      expect(output.includes(rawKey(privateKey).slice(0, 50))).toBe(false)
      expect(output).toContain('仍需用户充值页完成真实付款')
    } finally { unlinkSync(path); rmdirSync(dir) }
  })
})
