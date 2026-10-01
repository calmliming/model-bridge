/**
 * Reads the start of an upstream SSE response before any byte reaches the
 * client, so an empty reply can still be retried on another attempt.
 *
 * Reading stops at the first event the verdict passes, at a retry verdict,
 * at stream end, or after `maxWaitMs` (so a slow first event never holds the
 * response headers past reverse-proxy idle timeouts). The returned response
 * replays every byte read so far followed by the rest of the stream, so the
 * normal streaming path sees exactly what the upstream sent.
 */

import type { ReadableStreamReadResult } from 'node:stream/web'

export type PeekVerdict = 'continue' | 'pass' | { retry: string }

export interface PeekResult {
  response: Response
  /** Set when the stream ended (or was rejected) before any content. */
  retryReason: string | null
}

function eventData(block: string): string | null {
  const lines = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart())
  return lines.length ? lines.join('\n') : null
}

/** Parses the JSON `data:` payloads of a complete SSE transcript. */
export function sseDataEvents(text: string): unknown[] {
  const events: unknown[] = []
  for (const block of text.replace(/\r\n/g, '\n').split('\n\n')) {
    const data = eventData(block)
    if (!data || data === '[DONE]') continue
    try {
      events.push(JSON.parse(data))
    } catch {
      // Malformed frames are reported by the normal response path.
    }
  }
  return events
}

export async function peekSseStart(
  upstream: Response,
  verdictFor: (event: unknown) => PeekVerdict,
  maxWaitMs: number,
): Promise<PeekResult> {
  if (!upstream.body) return { response: upstream, retryReason: null }
  const reader = upstream.body.getReader()
  const decoder = new TextDecoder()
  const chunks: Uint8Array[] = []
  let buffered = ''
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null
  let done = false
  let readError: unknown = null
  let verdict: PeekVerdict = 'continue'

  const inspect = (block: string): PeekVerdict => {
    const data = eventData(block)
    if (!data || data === '[DONE]') return 'continue'
    try {
      return verdictFor(JSON.parse(data))
    } catch {
      // A malformed frame is left for the streaming path to report.
      return 'continue'
    }
  }

  const deadline = Date.now() + maxWaitMs
  while (verdict === 'continue' && !done && !readError) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    pending ??= reader.read()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), remaining) })
    let result: ReadableStreamReadResult<Uint8Array> | null
    try {
      result = await Promise.race([pending, timeout])
    } catch (error) {
      readError = error
      break
    } finally {
      clearTimeout(timer)
    }
    if (!result) break // Waited long enough; the pending read carries over.
    pending = null
    if (result.done) {
      done = true
      break
    }
    chunks.push(result.value)
    // Normalize the joined text so a CRLF split across chunks is still found.
    buffered = (buffered + decoder.decode(result.value, { stream: true })).replace(/\r\n/g, '\n')
    const blocks = buffered.split('\n\n')
    buffered = blocks.pop() ?? ''
    for (const block of blocks) {
      verdict = inspect(block)
      if (verdict !== 'continue') break
    }
  }
  if (done && verdict === 'continue') {
    buffered = (buffered + decoder.decode()).replace(/\r\n/g, '\n')
    if (buffered.trim()) verdict = inspect(buffered)
  }

  const retryReason = typeof verdict === 'object'
    ? verdict.retry
    : done && verdict === 'continue' ? 'empty_stream' : null

  const replay = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      if (readError) controller.error(readError)
      else if (done) controller.close()
    },
    async pull(controller) {
      try {
        const result = await (pending ?? reader.read())
        pending = null
        if (result.done) controller.close()
        else controller.enqueue(result.value)
      } catch (error) {
        controller.error(error)
      }
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
  return {
    response: new Response(replay, { status: upstream.status, statusText: upstream.statusText, headers: upstream.headers }),
    retryReason,
  }
}
