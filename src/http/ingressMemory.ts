import { Transform, type TransformCallback } from 'node:stream'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { config } from '../config'

let retainedBytes = 0
const leases = new WeakMap<FastifyRequest, { bytes: number; released: boolean; managed: boolean }>()

export function retainIngressUntilSettled(request: FastifyRequest): void {
  const lease = leases.get(request)
  if (lease) lease.managed = true
}

export function releaseIngressMemory(request: FastifyRequest): void {
  const lease = leases.get(request)
  if (!lease || lease.released) return
  lease.released = true
  retainedBytes -= lease.bytes
  lease.bytes = 0
}

export function ingressMemoryBytes(): number { return retainedBytes }

/** Reserve before the parser allocates, retain the reservation through relay settlement. */
export function registerIngressMemory(app: FastifyInstance): void {
  app.addHook('preParsing', async (request, reply, payload) => {
    if (request.method === 'GET' || request.method === 'HEAD') return payload
    const lease = { bytes: 0, released: false, managed: false }
    leases.set(request, lease)
    const reserve = (bytes: number) => {
      if (lease.released) throw Object.assign(new Error('Upload was cancelled'), { statusCode: 408 })
      if (lease.bytes + bytes > config.INGRESS_MEMORY_MAX_BYTES) throw Object.assign(new Error('Upload exceeds the configured safe request limit'), { statusCode: 413 })
      if (retainedBytes + bytes > config.INGRESS_MEMORY_MAX_BYTES) {
        reply.header('Retry-After', '5')
        throw Object.assign(new Error('Upload capacity is temporarily exhausted'), { statusCode: 503, code: 'INGRESS_CAPACITY' })
      }
      lease.bytes += bytes
      retainedBytes += bytes
    }
    reserve(64 * 1024)
    let timer: ReturnType<typeof setTimeout> | undefined
    class BudgetedUpload extends Transform {
      receivedEncodedLength = 0
      _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
        try {
          // Raw bytes, decoded strings and normalized copies share this budget.
          reserve(chunk.byteLength * 3)
          this.receivedEncodedLength += chunk.byteLength
          arm()
          callback(null, chunk)
        } catch (error) { callback(error as Error) }
      }
    }
    const stream = new BudgetedUpload()
    const arm = () => {
      clearTimeout(timer)
      timer = setTimeout(() => stream.destroy(Object.assign(new Error('Upload timed out'), { statusCode: 408 })), config.UPLOAD_TIMEOUT_MS)
      timer.unref()
    }
    const cleanup = () => { clearTimeout(timer); payload.off('error', onError); request.raw.off('aborted', aborted) }
    const onError = (error: Error) => stream.destroy(error)
    const aborted = () => { stream.destroy(); releaseIngressMemory(request) }
    payload.once('error', onError)
    request.raw.once('aborted', aborted)
    stream.once('end', cleanup)
    stream.once('close', cleanup)
    reply.raw.once('close', () => {
      if (lease.managed) return
      if (reply.raw.writableEnded) releaseIngressMemory(request)
      else { const release = setTimeout(() => releaseIngressMemory(request), config.STREAM_DRAIN_TIMEOUT_MS + 100); release.unref() }
    })
    arm()
    return payload.pipe(stream)
  })
  app.addHook('onResponse', async request => { if (!leases.get(request)?.managed) releaseIngressMemory(request) })
}
