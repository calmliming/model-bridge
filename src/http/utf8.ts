import { Transform, type TransformCallback } from 'node:stream'
import type { FastifyInstance } from 'fastify'

/** Reject corrupt Responses input before the JSON parser replaces invalid bytes. */
export function registerResponsesUtf8Validation(app: FastifyInstance): void {
  app.addHook('preParsing', async (request, reply, payload) => {
    const path = request.routeOptions.url ?? ''
    const mediaType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
    if (request.method !== 'POST' || !/\/responses(?:\/input_tokens)?$/.test(path) ||
      !/^application\/(?:[\w.+-]+\+)?json$/.test(mediaType)) return payload
    const decoder = new TextDecoder('utf-8', { fatal: true })
    const invalid = () => Object.assign(new Error('Responses request body must be valid UTF-8.'),
      { statusCode: 400, code: 'invalid_request_error' })
    class ValidatedUpload extends Transform {
      receivedEncodedLength = 0
      _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
        try {
          decoder.decode(chunk, { stream: true })
          this.receivedEncodedLength += chunk.byteLength
          callback(null, chunk)
        } catch { callback(invalid()) }
      }
      _flush(callback: TransformCallback) {
        try { decoder.decode(); callback() } catch { callback(invalid()) }
      }
    }
    const stream = new ValidatedUpload()
    const onError = (error: Error) => stream.destroy(error)
    const stop = () => stream.destroy()
    // Fastify can reject Content-Length before subscribing to this stream.
    // Still consume a late upload error after the error response has been sent.
    stream.on('error', () => {})
    payload.once('error', onError)
    payload.once('close', () => payload.off('error', onError))
    request.raw.once('aborted', stop)
    reply.raw.once('finish', stop)
    reply.raw.once('close', stop)
    stream.once('close', () => {
      request.raw.off('aborted', stop)
      reply.raw.off('finish', stop)
      reply.raw.off('close', stop)
      payload.unpipe(stream)
      // Stop an earlier upload-budget transform without destroying the socket
      // that still has to deliver the HTTP error to the client.
      if (payload !== request.raw) payload.destroy()
      else if (!payload.readableEnded) payload.resume()
    })
    return payload.pipe(stream)
  })
}
