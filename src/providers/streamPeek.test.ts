import { describe, expect, it } from 'vitest'
import { peekSseStart, sseDataEvents, type PeekVerdict } from './streamPeek'
import { antigravityEmptyTranscriptReason, antigravityStreamStartVerdict } from './antigravity/response'

const encoder = new TextEncoder()

/** An SSE response whose chunks arrive on demand, optionally never closing. */
function sseResponse(chunks: string[], options: { hang?: boolean; failAfter?: boolean } = {}) {
  let index = 0
  let pulls = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index++]!))
        return
      }
      if (options.failAfter) controller.error(new Error('socket reset'))
      else if (!options.hang) controller.close()
      else return new Promise(() => undefined)
    },
  }, { highWaterMark: 0 })
  return { response: new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req-1' } }), pulls: () => pulls }
}

const verdict = (event: unknown): PeekVerdict => {
  const kind = (event as { kind?: string }).kind
  return kind === 'content' ? 'pass' : kind === 'bad' ? { retry: 'bad_reply' } : 'continue'
}

describe('peekSseStart', () => {
  it('stops at the first content and replays every byte in order', async () => {
    const chunks = ['data: {"kind":"meta"}\r\n\r\ndata: {"ki', 'nd":"content"}\r\n\r\n', 'data: {"kind":"tail"}\n\n']
    const upstream = sseResponse(chunks)
    const peeked = await peekSseStart(upstream.response, verdict, 1_000)
    expect(peeked.retryReason).toBeNull()
    // Only the chunks up to the first content were read during the peek.
    expect(upstream.pulls()).toBe(2)
    expect(peeked.response.headers.get('x-request-id')).toBe('req-1')
    expect(await peeked.response.text()).toBe(chunks.join(''))
  })

  it('reports a retry verdict and an empty stream', async () => {
    const bad = await peekSseStart(sseResponse(['data: {"kind":"meta"}\n\n', 'data: {"kind":"bad"}\n\n']).response, verdict, 1_000)
    expect(bad.retryReason).toBe('bad_reply')
    const empty = await peekSseStart(sseResponse(['data: {"kind":"meta"}\n\n', ': comment\n\n']).response, verdict, 1_000)
    expect(empty.retryReason).toBe('empty_stream')
    expect(await empty.response.text()).toBe('data: {"kind":"meta"}\n\n: comment\n\n')
    // A final event without the trailing blank line is still inspected.
    const unterminated = await peekSseStart(sseResponse(['data: {"kind":"content"}']).response, verdict, 1_000)
    expect(unterminated.retryReason).toBeNull()
  })

  it('stops waiting after the deadline without losing the pending read', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let step = 0
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (step === 0) controller.enqueue(encoder.encode('data: {"kind":"meta"}\n\n'))
        else if (step === 1) { await gate; controller.enqueue(encoder.encode('data: {"kind":"content"}\n\n')) }
        else controller.close()
        step++
      },
    }, { highWaterMark: 0 })
    const peeked = await peekSseStart(new Response(body), verdict, 30)
    expect(peeked.retryReason).toBeNull()
    release()
    expect(await peeked.response.text()).toBe('data: {"kind":"meta"}\n\ndata: {"kind":"content"}\n\n')
  })

  it('surfaces a read error to the streaming path instead of retrying', async () => {
    const peeked = await peekSseStart(sseResponse(['data: {"kind":"meta"}\n\n'], { failAfter: true }).response, verdict, 1_000)
    expect(peeked.retryReason).toBeNull()
    await expect(peeked.response.text()).rejects.toThrow('socket reset')
  })

  it('parses a complete transcript', () => {
    expect(sseDataEvents('data: {"a":1}\r\n\r\n: ping\n\ndata: [DONE]\n\ndata: oops\n\ndata: {"b":2}')).toEqual([{ a: 1 }, { b: 2 }])
  })
})

describe('Antigravity stream-start verdict', () => {
  const event = (candidate: Record<string, unknown>) => ({ response: { candidates: [candidate] } })

  it('treats text, thoughts, tool calls and media as content', () => {
    for (const part of [{ text: 'hi' }, { text: 'hmm', thought: true }, { functionCall: { name: 'f', args: {} } }, { inlineData: { mimeType: 'image/png', data: 'AA' } }]) {
      expect(antigravityStreamStartVerdict(event({ content: { parts: [part] } }))).toBe('pass')
    }
  })

  it('does not count signature-only parts and retries MALFORMED_FUNCTION_CALL', () => {
    const signatureOnly = event({ content: { parts: [{ text: '', thoughtSignature: 'sig' }] } })
    expect(antigravityStreamStartVerdict(signatureOnly)).toBe('continue')
    expect(antigravityStreamStartVerdict(event({ content: { parts: [{ thoughtSignature: 'sig' }] }, finishReason: 'MALFORMED_FUNCTION_CALL' })))
      .toEqual({ retry: 'MALFORMED_FUNCTION_CALL' })
  })

  it('passes explicit outcomes through unchanged', () => {
    expect(antigravityStreamStartVerdict(event({ finishReason: 'STOP' }))).toBe('pass')
    expect(antigravityStreamStartVerdict(event({ finishReason: 'SAFETY' }))).toBe('pass')
    expect(antigravityStreamStartVerdict({ response: { promptFeedback: { blockReason: 'OTHER' } } })).toBe('pass')
    expect(antigravityStreamStartVerdict({ error: { code: 429 } })).toBe('pass')
    expect(antigravityStreamStartVerdict({ response: { usageMetadata: { promptTokenCount: 3 } } })).toBe('continue')
  })

  it('classifies complete transcripts', () => {
    expect(antigravityEmptyTranscriptReason([event({ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' })])).toBeNull()
    expect(antigravityEmptyTranscriptReason([event({ content: { parts: [{ thoughtSignature: 's' }] }, finishReason: 'MALFORMED_FUNCTION_CALL' })]))
      .toBe('MALFORMED_FUNCTION_CALL')
    expect(antigravityEmptyTranscriptReason([{ response: { usageMetadata: {} } }])).toBe('empty_stream')
  })
})
