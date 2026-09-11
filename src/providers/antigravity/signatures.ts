import { createHash } from 'node:crypto'

export interface SignatureScope { apiKeyId: string; accountId: string; model: string; sessionKeyHash?: string | null }
const cache = new Map<string, { signature: string; expires: number }>()
const TTL = 30 * 60_000
const MAX_BYTES = 16 * 1024 * 1024
let bytes = 0

function key(scope: SignatureScope, id: string): string {
  return createHash('sha256').update(JSON.stringify([scope.apiKeyId, scope.accountId, scope.model, scope.sessionKeyHash ?? null, id])).digest('hex')
}

/** Keep tool signatures when an Anthropic client discards nonstandard fields. */
export function rememberToolSignature(scope: SignatureScope, id: string, signature: string): void {
  const size = Buffer.byteLength(signature)
  if (size > 65536) return
  const k = key(scope, id)
  const existing = cache.get(k)
  if (existing) { bytes -= Buffer.byteLength(existing.signature); cache.delete(k) }
  for (const [oldKey, item] of cache) {
    if (item.expires > Date.now() && bytes + size <= MAX_BYTES && cache.size < 5000) break
    bytes -= Buffer.byteLength(item.signature)
    cache.delete(oldKey)
  }
  cache.set(k, { signature, expires: Date.now() + TTL })
  bytes += size
}

export function recallToolSignature(scope: SignatureScope, id: string): string | undefined {
  const k = key(scope, id)
  const item = cache.get(k)
  if (item && item.expires <= Date.now()) {
    cache.delete(k)
    bytes -= Buffer.byteLength(item.signature)
    return undefined
  }
  return item?.signature
}
