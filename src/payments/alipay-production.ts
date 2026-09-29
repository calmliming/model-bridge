import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { PaymentConfig } from './providers/base'
import { parseAlipayRate } from './providers/alipay-amount'

export const ALIPAY_PRODUCTION_GATEWAY = 'https://openapi.alipay.com/gateway.do'
type Environment = { [key: `ALIPAY_${string}`]: string | undefined }

function value(env: Environment, name: `ALIPAY_${string}`): string {
  return env[name]?.trim() ?? ''
}

function readKey(env: Environment, name: `ALIPAY_${string}`): string {
  const inline = value(env, name)
  const path = value(env, `${name}_FILE`)
  if (inline && path) throw new Error(`Configure only one of ${name} and ${name}_FILE`)
  if (!path) return inline.replace(/\\n/g, '\n')
  try {
    return readFileSync(path, 'utf8').trim().replace(/\\n/g, '\n')
  } catch {
    throw new Error(`Cannot read ${name}_FILE`)
  }
}

function checkKey(key: string, label: string, field: string, isPrivate: boolean): void {
  try {
    if (key.startsWith('-----BEGIN ') && !key.startsWith(`-----BEGIN ${label}-----`)) {
      throw new Error('Unsupported PEM format')
    }
    const pem = key.startsWith('-----BEGIN ') ? key : `-----BEGIN ${label}-----\n${key}\n-----END ${label}-----`
    const parsed: KeyObject = isPrivate ? createPrivateKey(pem) : createPublicKey(pem)
    if (parsed.asymmetricKeyType !== 'rsa' || (parsed.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
      throw new Error('Unsupported key')
    }
  } catch {
    throw new Error(`${field} must be a valid RSA key of at least 2048 bits; check ALIPAY_KEY_TYPE for the private key`)
  }
}

function callbackUrl(raw: string, field: string, path: string): string {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.pathname !== path || url.username || url.password || url.search || url.hash
      || url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname === '[::1]'
      || /^(127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)) {
      throw new Error('Invalid callback')
    }
    return url.toString()
  } catch {
    throw new Error(`${field} must be a public HTTPS URL ending in ${path}`)
  }
}

/** Production configuration loader without server startup or environment mutations. */
export function parseAlipayProductionConfig(env: Environment): PaymentConfig['alipay'] {
  const credentialFields = ['ALIPAY_APP_ID', 'ALIPAY_PRIVATE_KEY', 'ALIPAY_PUBLIC_KEY', 'ALIPAY_PRIVATE_KEY_FILE', 'ALIPAY_PUBLIC_KEY_FILE'] as const
  if (credentialFields.every(field => !value(env, field))) return undefined
  const appId = value(env, 'ALIPAY_APP_ID')
  const privateKey = readKey(env, 'ALIPAY_PRIVATE_KEY')
  const alipayPublicKey = readKey(env, 'ALIPAY_PUBLIC_KEY')
  if (!appId || !privateKey || !alipayPublicKey) {
    throw new Error('Production Alipay requires ALIPAY_APP_ID, ALIPAY_PRIVATE_KEY and ALIPAY_PUBLIC_KEY (or their key files)')
  }
  if (!/^\d{16}$/.test(appId)) throw new Error('ALIPAY_APP_ID must be the 16-digit production application ID')
  const keyType = value(env, 'ALIPAY_KEY_TYPE') || (privateKey.includes('BEGIN PRIVATE KEY') ? 'PKCS8' : 'PKCS1')
  if (keyType !== 'PKCS1' && keyType !== 'PKCS8') throw new Error('ALIPAY_KEY_TYPE must be PKCS1 or PKCS8')
  if (privateKey.startsWith('-----BEGIN ') && !privateKey.startsWith(`-----BEGIN ${keyType === 'PKCS8' ? 'PRIVATE KEY' : 'RSA PRIVATE KEY'}-----`)) {
    throw new Error('ALIPAY_KEY_TYPE does not match the private key PEM header')
  }
  checkKey(privateKey, keyType === 'PKCS8' ? 'PRIVATE KEY' : 'RSA PRIVATE KEY', 'ALIPAY_PRIVATE_KEY', true)
  checkKey(alipayPublicKey, 'PUBLIC KEY', 'ALIPAY_PUBLIC_KEY', false)
  const gatewayUrl = value(env, 'ALIPAY_GATEWAY') || ALIPAY_PRODUCTION_GATEWAY
  if (gatewayUrl !== ALIPAY_PRODUCTION_GATEWAY) throw new Error('ALIPAY_ENV=production requires the official production ALIPAY_GATEWAY')
  const sellerId = value(env, 'ALIPAY_SELLER_ID')
  const sellerEmail = value(env, 'ALIPAY_SELLER_EMAIL')
  if (!sellerId && !sellerEmail) throw new Error('Production Alipay requires ALIPAY_SELLER_ID or ALIPAY_SELLER_EMAIL')
  const returnRaw = value(env, 'ALIPAY_RETURN_URL')
  // Preserve existing installations; new deployments should select their contracted product explicitly.
  const paymentMode = value(env, 'ALIPAY_PAYMENT_MODE') || (returnRaw ? 'both' : 'qr')
  if (!['qr', 'web', 'both'].includes(paymentMode)) throw new Error('ALIPAY_PAYMENT_MODE must be qr, web or both')
  const notifyUrl = callbackUrl(value(env, 'ALIPAY_NOTIFY_URL'), 'ALIPAY_NOTIFY_URL', '/api/payment/callback/alipay')
  const returnUrl = paymentMode !== 'qr' || returnRaw
    ? callbackUrl(returnRaw, 'ALIPAY_RETURN_URL', '/api/payment/return/alipay') : undefined
  const usdCnyRate = value(env, 'ALIPAY_USD_CNY_RATE') || '7.20'
  parseAlipayRate(usdCnyRate)
  return {
    appId, privateKey, alipayPublicKey, keyType, gatewayUrl, notifyUrl, returnUrl,
    sellerId, sellerEmail, usdCnyRate, paymentMode: paymentMode as 'qr' | 'web' | 'both',
  }
}
