import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { config } from './config'

const ALGORITHM = 'aes-256-gcm'
const KEY = Buffer.from(config.ENCRYPTION_KEY, 'hex')

/**
 * Encrypts a UTF-8 string with AES-256-GCM. Used for OAuth tokens at
 * rest. Output format: `<iv-hex>:<auth-tag-hex>:<ciphertext-hex>`.
 */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, KEY, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`
}

/** Reverses {@link encrypt}. Throws if the payload is malformed or tampered with. */
export function decrypt(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(':')
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error('crypto: malformed ciphertext payload')
  }
  const decipher = createDecipheriv(ALGORITHM, KEY, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]).toString('utf8')
}
