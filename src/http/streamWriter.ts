import type { ServerResponse } from 'node:http'

/** A slow/closed client must not cause unbounded buffering or hold upstream work forever. */
export async function writeStreamChunk(raw: ServerResponse | null, chunk: string | Buffer,
  signal?: AbortSignal, timeoutMs = 30_000): Promise<boolean> {
  if (!raw) return true
  const closed = () => raw.destroyed || raw.writableEnded || signal?.aborted
  const drain = (): Promise<boolean> => new Promise(resolve => {
    const finish = (ok: boolean) => {
      clearTimeout(timer)
      raw.off('drain', onDrain)
      raw.off('close', onClose)
      raw.off('error', onClose)
      signal?.removeEventListener('abort', onClose)
      resolve(ok)
    }
    const onDrain = () => finish(!closed())
    const onClose = () => finish(false)
    const timer = setTimeout(() => { finish(false); raw.destroy() }, timeoutMs)
    timer.unref()
    raw.once('drain', onDrain)
    raw.once('close', onClose)
    raw.once('error', onClose)
    signal?.addEventListener('abort', onClose, { once: true })
    if (closed()) finish(false)
    else if (!raw.writableNeedDrain) finish(true)
  })
  if (closed()) return false
  if (raw.writableNeedDrain && !await drain()) return false
  try {
    if (raw.write(chunk)) return true
    return await drain()
  } catch { return false }
}
