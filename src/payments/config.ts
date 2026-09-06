import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { config } from '../config'
import type { PaymentConfig } from './providers/base'

const PROJECT_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const SANDBOX_GATEWAY = 'https://openapi-sandbox.dl.alipaydev.com/gateway.do'

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Alipay sandbox configuration is missing ${field}`)
  }
  return value.trim()
}

export function parseAlipaySandboxConfig(value: unknown): {
  appId: string
  privateKey: string
  alipayPublicKey: string
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Alipay sandbox configuration must be a JSON object')
  }
  const row = value as Record<string, unknown>
  if (!Array.isArray(row.appIds) || row.appIds.length === 0) {
    throw new Error('Alipay sandbox configuration is missing appIds[0]')
  }
  return {
    appId: requiredString(row.appIds[0], 'appIds[0]'),
    // Node.js must use the original PKCS#1 value. Never transform or wrap it.
    privateKey: requiredString(row.appPrivatePkcsKey, 'appPrivatePkcsKey'),
    alipayPublicKey: requiredString(row.alipayPublicKey, 'alipayPublicKey'),
  }
}

/** Resolve production env config or the explicitly enabled protected sandbox file. */
export function loadAlipayPaymentConfig(): PaymentConfig['alipay'] | undefined {
  const common = {
    notifyUrl: config.ALIPAY_NOTIFY_URL,
    returnUrl: config.ALIPAY_RETURN_URL,
    sellerId: config.ALIPAY_SELLER_ID,
    sellerEmail: config.ALIPAY_SELLER_EMAIL,
    usdCnyRate: config.ALIPAY_USD_CNY_RATE,
  }

  if (config.ALIPAY_ENV === 'sandbox') {
    const path = resolve(PROJECT_ROOT, '.alipay-sandbox.json')
    let decoded: unknown
    try {
      decoded = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      throw new Error(`Alipay sandbox configuration is not ready at ${path}`, { cause: error })
    }
    return {
      ...parseAlipaySandboxConfig(decoded),
      ...common,
      gatewayUrl: SANDBOX_GATEWAY,
    }
  }

  const credentials = [config.ALIPAY_APP_ID, config.ALIPAY_PRIVATE_KEY, config.ALIPAY_PUBLIC_KEY]
  if (credentials.every((value) => !value?.trim())) return undefined
  if (credentials.some((value) => !value?.trim())) {
    throw new Error('Production Alipay configuration requires APP_ID, PRIVATE_KEY, and PUBLIC_KEY together')
  }
  return {
    appId: config.ALIPAY_APP_ID!,
    privateKey: config.ALIPAY_PRIVATE_KEY!,
    alipayPublicKey: config.ALIPAY_PUBLIC_KEY!,
    gatewayUrl: config.ALIPAY_GATEWAY,
    ...common,
  }
}
