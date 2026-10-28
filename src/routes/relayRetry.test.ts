import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyBufferedResponsesFailure, classifyUpstreamFailure, isCloudflareBotBlockResponse } from './relay'

const now = Date.parse('2026-10-26T10:00:00Z')
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(now) })
afterEach(() => { vi.restoreAllMocks() })
const overload = { code: 'server_is_overloaded', message: 'Our servers are currently overloaded. Please try again later.' }
const failed = (error: Record<string, unknown>) => `data: ${JSON.stringify({ type: 'response.failed', response: { error } })}\n\n`

describe('request overload retry hints', () => {
  it.each<{ headers: Record<string, string>; delay: number }>([
    { headers: { 'retry-after': '6' }, delay: 6000 },
    { headers: { 'retry-after-ms': '7000' }, delay: 7000 },
    { headers: { 'retry-after': '6', 'retry-after-ms': '7000' }, delay: 6000 },
    { headers: { 'retry-after': 'Mon, 26 Oct 2026 10:00:07 GMT' }, delay: 7000 },
    { headers: { 'retry-after': '60' }, delay: 8000 },
    { headers: { 'retry-after-ms': '-1' }, delay: 0 },
    { headers: { 'retry-after': '-1', 'retry-after-ms': 'Infinity' }, delay: 0 },
    { headers: { 'retry-after': 'invalid', 'retry-after-ms': 'NaN' }, delay: 0 },
  ])('uses bounded request waits without persistent penalties: $headers', async ({ headers, delay }) => {
    for (const status of [429, 503]) {
      const result = await classifyUpstreamFailure('openai', Response.json({ error: overload }, { status, headers }), 'gpt-5.5')
      expect(result).toEqual({ penalty: null, retryable: true, transientResponse: true, retryDelayMs: delay })
    }
  })

  it.each(['error', 'response.error'])('reads nested hints at %s', async path => {
    const error = { ...overload, headers: { 'Retry-After-Ms': 7000 } }
    const body = path === 'error' ? { error } : { response: { error } }
    expect(await classifyUpstreamFailure('openai', Response.json(body, { status: 503 })))
      .toMatchObject({ penalty: null, retryDelayMs: 7000, transientResponse: true })
    expect(await classifyBufferedResponsesFailure('openai', failed(error)))
      .toMatchObject({ penalty: null, retryDelayMs: 7000, transientResponse: true })
  })

  it('preserves HTTP retry headers through buffered/stream terminal classification', async () => {
    expect(await classifyBufferedResponsesFailure('openai', failed(overload), 'gpt-5.5', new Headers({ 'retry-after': '6' })))
      .toMatchObject({ penalty: null, retryDelayMs: 6000, transientResponse: true })
  })

  it('keeps real quota limits account-scoped even if their message mentions overload', async () => {
    const result = await classifyUpstreamFailure('openai', Response.json({ error: {
      ...overload, code: 'usage_limit_reached', resets_in_seconds: 3600,
    } }, { status: 429, headers: { 'retry-after-ms': '7000' } }), 'gpt-5.5')
    expect(result).toMatchObject({ penalty: 'rate_limited', accountScoped: true })
    expect(result.transientResponse).not.toBe(true)
    expect(result.retryDelayMs).toBeUndefined()
  })

  it('does not reinterpret other providers or vague retry wording as OpenAI overload', async () => {
    expect(await classifyUpstreamFailure('claude', Response.json({ error: overload }, { status: 503 })))
      .toMatchObject({ penalty: 'rate_limited', modelScoped: true })
    expect(await classifyUpstreamFailure('openai', Response.json({ error: { message: 'try again later' } }, { status: 503 })))
      .toMatchObject({ penalty: 'rate_limited', modelScoped: true })
  })

  it.each<{ headers: Record<string, string>; body: unknown }>([
    { headers: { 'retry-after-ms': '7000' }, body: { error: { code: 'rate_limit_exceeded' } } },
    { headers: {}, body: { error: { code: 'rate_limit_exceeded', headers: { 'Retry-After': '7' } } } },
    { headers: {}, body: { response: { error: { code: 'rate_limit_exceeded', headers: { 'retry-after-ms': '7000' } } } } },
  ])('also parses hints for ordinary rate-limit cooldowns', async ({ headers, body }) => {
    expect(await classifyUpstreamFailure('openai', Response.json(body, { status: 429, headers }), 'gpt-5.5'))
      .toMatchObject({ penalty: 'rate_limited', resetAt: now + 7000 })
  })

  it('does not retry policy errors or a failure after actual content', async () => {
    expect(await classifyBufferedResponsesFailure('openai', failed({ ...overload, code: 'cyber_policy' })))
      .toEqual({ penalty: null, retryable: false })
    const output = 'data: {"type":"response.function_call_arguments.done","arguments":""}\n\n'
    expect(await classifyBufferedResponsesFailure('openai', output + failed(overload))).toBeNull()
    const empty = 'data: {"type":"response.output_item.added","item":{"type":"message","content":[]}}\n\n'
    expect(await classifyBufferedResponsesFailure('openai', empty + failed(overload)))
      .toMatchObject({ retryable: true, penalty: null, transientResponse: true })
  })
})

describe('Cloudflare 1010 classification', () => {
  it.each([
    'error code: 1010', '<html>Error code: 1010 quota exceeded</html>',
    '{"cloudflare_error":true,"code":1010,"message":"quota exceeded"}',
    '{"errors":[{"Cloudflare_Error":true,"error_code":"1010"}]}',
    '{"error_name":"browser_signature_banned"}',
  ])('rotates accounts without penalty for %s', async text => {
    expect(isCloudflareBotBlockResponse(text)).toBe(true)
    for (const provider of ['openai', 'sub2api', 'claude', 'gemini', 'antigravity']) {
      expect(await classifyUpstreamFailure(provider, new Response(text, { status: 403 })))
        .toEqual({ penalty: null, retryable: true, accountScoped: true })
    }
  })

  it.each([
    '{"message":"error code: 1010"}', '{"error":{"code":1010,"message":"account banned"}}',
    '{"cloudflare_error":"true","code":1010}', '{"cloudflare_error":true,"code":1011}',
    'error code: 10100', '{"code":1010',
  ])('does not exempt unrelated or malformed responses: %s', async text => {
    expect(isCloudflareBotBlockResponse(text)).toBe(false)
    expect(await classifyUpstreamFailure('openai', new Response(text, { status: 403 })))
      .toEqual({ penalty: null, retryable: false })
  })
})
