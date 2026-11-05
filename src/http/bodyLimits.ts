import { config } from '../config'
import { cancelUpstreamResponse } from './cancellation'
import { accountUpstreamMemory } from './upstreamMemory'

export class UpstreamResourceError extends Error {
  readonly statusCode = 502
  constructor(readonly code: 'response_too_large' | 'upstream_idle_timeout', message: string) { super(message) }
}

/** A deadline per read, independent of the lifetime of a healthy stream. */
export async function readWithDeadline<T>(reader: ReadableStreamDefaultReader<T>, timeoutMs = config.UPSTREAM_IDLE_TIMEOUT_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([reader.read(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new UpstreamResourceError('upstream_idle_timeout', 'Upstream stopped sending data.'))
        void reader.cancel().catch(() => {})
      }, timeoutMs)
      timer.unref()
    })])
  } finally { clearTimeout(timer) }
}

/** Limits complete and incomplete SSE frames without limiting stream duration. */
export class SseBudget {
  private eventBytes = 0
  private lineBytes = 0
  private lines = 0
  private content = false
  constructor(private maxBytes = config.SSE_EVENT_MAX_BYTES, private maxLines = config.SSE_EVENT_MAX_LINES) {}
  feed(text: string): void {
    const parts = text.split('\n')
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!
      const size = Buffer.byteLength(part)
      this.eventBytes += size
      this.lineBytes += size
      this.content ||= /[^\r]/.test(part)
      accountUpstreamMemory(this.eventBytes)
      if (this.eventBytes > this.maxBytes || this.lineBytes > this.maxBytes || this.lines > this.maxLines) {
        throw new UpstreamResourceError('response_too_large', 'Upstream SSE event exceeds the configured limit.')
      }
      if (i < parts.length - 1) {
        if (!this.content) { this.eventBytes = 0; this.lines = 0 }
        else { this.eventBytes++; this.lines++ }
        this.lineBytes = 0
        this.content = false
        if (this.lines > this.maxLines || this.eventBytes > this.maxBytes) throw new UpstreamResourceError('response_too_large', 'Upstream SSE event exceeds the configured limit.')
      }
    }
  }
}

export async function readBoundedText(response: Response, limit = config.UPSTREAM_BUFFER_MAX_BYTES): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await readWithDeadline(reader)
      if (done) break
      bytes += value.byteLength
      accountUpstreamMemory(bytes)
      if (bytes > limit) throw new UpstreamResourceError('response_too_large', 'Upstream response exceeds the configured buffer limit.')
      chunks.push(value)
    }
    return Buffer.concat(chunks, bytes).toString('utf8')
  } catch (error) {
    void reader.cancel().catch(() => {})
    await cancelUpstreamResponse(response)
    throw error
  } finally { reader.releaseLock() }
}

/** Only recognize framing at the beginning, followed by a JSON event or DONE. */
export function bodyHasSseFraming(raw: string): boolean {
  const prefix = raw.trimStart().slice(0, config.UPSTREAM_BUFFER_MAX_BYTES).replace(/\r\n/g, '\n')
  const lines = prefix.split('\n')
  let data = ''
  for (const line of lines) {
    if (!line.trim() && data) break
    if (line.startsWith(':') || /^event:\s*[\w.:-]+\s*$/.test(line) || !line.trim()) continue
    if (!line.startsWith('data:')) return false
    data += line.slice(5).trimStart()
  }
  if (data === '[DONE]') return true
  try { const value = JSON.parse(data); return !!value && typeof value === 'object' && !Array.isArray(value) }
  catch { return false }
}
