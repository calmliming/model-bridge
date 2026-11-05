import { AsyncLocalStorage } from 'node:async_hooks'
import { config } from '../config'

const current = new AsyncLocalStorage<{ peak: number }>()
let reserved = 0
export class UpstreamMemoryError extends Error {
  readonly code = 'gateway_capacity_exhausted'
  readonly statusCode = 503
  constructor() { super('Gateway response capacity is temporarily exhausted') }
}
export function upstreamMemoryBytes(): number { return reserved }

/** Retain a conservative peak through conversion, output backpressure and billing. */
export function accountUpstreamMemory(bytes: number): void {
  const owner = current.getStore()
  if (!owner) return
  const estimate = Math.ceil(bytes * 3)
  const extra = Math.max(0, estimate - owner.peak)
  if (reserved + extra > config.UPSTREAM_MEMORY_MAX_BYTES) {
    throw new UpstreamMemoryError()
  }
  owner.peak += extra
  reserved += extra
}
export async function withUpstreamMemory<T>(run: () => Promise<T>): Promise<T> {
  const owner = { peak: 0 }
  try { return await current.run(owner, run) }
  finally { reserved -= owner.peak }
}
