import { EventEmitter } from 'node:events'
import { createServer, get } from 'node:http'
import type { ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { writeStreamChunk } from './streamWriter'

function response() {
  const raw = Object.assign(new EventEmitter(), {
    destroyed: false, writableEnded: false, writableNeedDrain: false,
    write: vi.fn((_chunk: unknown) => true),
    destroy: vi.fn(),
  })
  raw.destroy.mockImplementation(() => { raw.destroyed = true; raw.emit('close') })
  return { raw, stream: raw as unknown as ServerResponse }
}

describe('stream backpressure', () => {
  it('pauses production for a real paused HTTP client and resumes without losing bytes', async () => {
    let start!: () => void
    const ready = new Promise<void>(resolve => { start = resolve })
    let chunks = 0
    const chunk = Buffer.alloc(1024 * 1024, 65)
    const server = createServer(async (_request, reply) => {
      reply.writeHead(200, { connection: 'close', 'content-type': 'application/octet-stream' })
      reply.flushHeaders()
      await ready
      for (; chunks < 64; chunks++) if (!await writeStreamChunk(reply, chunk)) break
      reply.end()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    let request: ReturnType<typeof get> | undefined
    try {
      const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
        request = get(`http://127.0.0.1:${address.port}`, { agent: false }, resolve)
        request.on('error', reject)
      })
      response.pause()
      let received = 0
      response.on('data', data => { received += data.length })
      const ended = new Promise<void>((resolve, reject) => { response.on('end', resolve); response.on('error', reject) })
      start()
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(chunks).toBeLessThan(64)
      response.resume()
      await ended
      expect(chunks).toBe(64)
      expect(received).toBe(64 * chunk.length)
    } finally {
      start()
      request?.destroy()
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('pauses subsequent writes until the client drains and preserves order', async () => {
    const { raw, stream } = response()
    raw.write.mockImplementationOnce(() => { raw.writableNeedDrain = true; return false })
    let complete = false
    const task = (async () => { await writeStreamChunk(stream, 'first'); await writeStreamChunk(stream, 'second'); complete = true })()
    await Promise.resolve()
    expect(complete).toBe(false)
    expect(raw.write.mock.calls).toEqual([['first']])
    raw.writableNeedDrain = false
    raw.emit('drain')
    await task
    expect(raw.write.mock.calls).toEqual([['first'], ['second']])
    expect(raw.eventNames()).toEqual([])
  })

  it.each(['close', 'error', 'abort'])('unblocks and removes listeners on %s', async event => {
    const { raw, stream } = response()
    const controller = new AbortController()
    raw.writableNeedDrain = true
    const task = writeStreamChunk(stream, 'held', controller.signal)
    if (event === 'abort') controller.abort()
    else raw.emit(event)
    expect(await task).toBe(false)
    expect(raw.write).not.toHaveBeenCalled()
    expect(raw.eventNames()).toEqual([])
  })

  it('times out a stalled client and destroys the socket to abort upstream generation', async () => {
    vi.useFakeTimers()
    try {
      const { raw, stream } = response()
      raw.writableNeedDrain = true
      const task = writeStreamChunk(stream, 'held', undefined, 500)
      await vi.advanceTimersByTimeAsync(500)
      expect(await task).toBe(false)
      expect(raw.destroyed).toBe(true)
      expect(raw.write).not.toHaveBeenCalled()
      expect(raw.eventNames()).toEqual([])
    } finally { vi.useRealTimers() }
  })

  it('never writes to an already aborted or closed client', async () => {
    const { raw, stream } = response()
    expect(await writeStreamChunk(stream, 'held', AbortSignal.abort())).toBe(false)
    raw.writableEnded = true
    expect(await writeStreamChunk(stream, 'held')).toBe(false)
    expect(raw.write).not.toHaveBeenCalled()
  })
})
