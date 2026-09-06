import { describe, expect, it } from 'vitest'
import { parseAlipaySandboxConfig } from './config'

describe('parseAlipaySandboxConfig', () => {
  it('selects appIds[0] and the Node.js PKCS#1 private key field', () => {
    expect(parseAlipaySandboxConfig({
      appIds: ['sandbox_app_1'],
      appPrivateKey: 'pkcs8-for-java',
      appPrivatePkcsKey: 'pkcs1-for-node',
      alipayPublicKey: 'alipay-public-key',
    })).toEqual({
      appId: 'sandbox_app_1',
      privateKey: 'pkcs1-for-node',
      alipayPublicKey: 'alipay-public-key',
    })
  })

  it('does not fall back to the Java PKCS#8 field', () => {
    expect(() => parseAlipaySandboxConfig({
      appIds: ['sandbox_app_1'],
      appPrivateKey: 'pkcs8-for-java',
      alipayPublicKey: 'alipay-public-key',
    })).toThrow(/appPrivatePkcsKey/)
  })
})
