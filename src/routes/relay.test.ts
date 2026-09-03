import type { ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import {
  classifyUpstreamFailure,
  classifyBufferedResponsesFailure,
  isAnthropicFableModel,
  isAnthropicFableOnlyWindowExceeded,
  isOpenaiSparkModel,
  newResponsesStreamState,
  noteResponsesTerminal,
  redactUrls,
  registerRelayRoutes,
  responsesStreamStatus,
  shouldRetrySameRelayAccount,
  startStreamingResponse,
  writeSseEventBlock,
} from './relay'

describe('startStreamingResponse', () => {
  it('disables intermediary buffering and flushes SSE headers immediately', () => {
    const setNoDelay = vi.fn()
    const writeHead = vi.fn()
    const flushHeaders = vi.fn()
    const raw = {
      socket: { setNoDelay },
      writeHead,
      flushHeaders,
    } as unknown as ServerResponse

    startStreamingResponse(raw, 200)

    expect(setNoDelay).toHaveBeenCalledWith(true)
    expect(writeHead).toHaveBeenCalledWith(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    expect(flushHeaders).toHaveBeenCalledOnce()
  })

  it('preserves a provider-specific streaming content type', () => {
    const writeHead = vi.fn()
    const raw = {
      socket: null,
      writeHead,
      flushHeaders: vi.fn(),
    } as unknown as ServerResponse

    startStreamingResponse(raw, 206, 'text/event-stream; charset=utf-8')

    expect(writeHead).toHaveBeenCalledWith(
      206,
      expect.objectContaining({ 'content-type': 'text/event-stream; charset=utf-8' }),
    )
  })
})

describe('writeSseEventBlock', () => {
  it('writes a complete SSE event in one separately flushable response write', () => {
    const write = vi.fn(() => true)
    const raw = { destroyed: false, writableEnded: false, write } as unknown as ServerResponse

    expect(writeSseEventBlock(raw, 'event: content_block_delta\ndata: {"type":"content_block_delta"}')).toBe(true)
    expect(write).toHaveBeenCalledWith(
      'event: content_block_delta\ndata: {"type":"content_block_delta"}\n\n',
    )
  })

  it('does not write after the downstream response has ended', () => {
    const write = vi.fn(() => true)
    const raw = { destroyed: false, writableEnded: true, write } as unknown as ServerResponse

    expect(writeSseEventBlock(raw, 'data: {}')).toBe(false)
    expect(write).not.toHaveBeenCalled()
  })
})

describe('OpenAI Images route registration', () => {
  it('registers both clean and provider-prefixed endpoints plus multipart parsing', async () => {
    const app = Fastify()
    registerRelayRoutes(app)
    app.post('/multipart-parser-probe', async (request) => ({
      bytes: Buffer.isBuffer(request.body) ? request.body.byteLength : -1,
    }))
    await app.ready()

    expect(app.hasRoute({ method: 'POST', url: '/v1/images/generations' })).toBe(true)
    expect(app.hasRoute({ method: 'POST', url: '/v1/images/edits' })).toBe(true)
    expect(app.hasRoute({ method: 'POST', url: '/api/openai/v1/images/generations' })).toBe(true)
    expect(app.hasRoute({ method: 'POST', url: '/api/openai/v1/images/edits' })).toBe(true)
    expect(app.hasRoute({ method: 'POST', url: '/api/openai/v1/responses/input_tokens' })).toBe(true)
    expect(app.hasRoute({ method: 'POST', url: '/v1/responses/input_tokens' })).toBe(true)
    expect(app.hasRoute({ method: 'POST', url: '/responses/input_tokens' })).toBe(true)

    const boundary = 'route-test-boundary'
    const payload = `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\ndraw\r\n--${boundary}--\r\n`
    const response = await app.inject({
      method: 'POST',
      url: '/multipart-parser-probe',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    })
    expect(response.json()).toEqual({ bytes: Buffer.byteLength(payload) })
    await app.close()
  })
})

describe('responsesStreamStatus', () => {
  it('records response.completed as success', () => {
    const state = newResponsesStreamState()
    noteResponsesTerminal({ type: 'response.completed', response: {} }, state)
    expect(responsesStreamStatus(true, true, state)).toBe('success')
  })

  it('records response.failed as error (e.g. cyber_policy hard block)', () => {
    const state = newResponsesStreamState()
    noteResponsesTerminal(
      { type: 'response.failed', response: { error: { code: 'cyber_policy', message: 'blocked' } } },
      state,
    )
    expect(responsesStreamStatus(true, true, state)).toBe('error')
  })

  it('records response.incomplete as error', () => {
    const state = newResponsesStreamState()
    noteResponsesTerminal({ type: 'response.incomplete', response: {} }, state)
    expect(responsesStreamStatus(true, true, state)).toBe('error')
  })

  it('treats a stream with no terminal event as error', () => {
    const state = newResponsesStreamState()
    noteResponsesTerminal({ type: 'response.output_text.delta', delta: 'hi' }, state)
    expect(responsesStreamStatus(true, true, state)).toBe('error')
  })

  it('still records error when a failure precedes any completion', () => {
    const state = newResponsesStreamState()
    noteResponsesTerminal({ type: 'response.failed', response: {} }, state)
    noteResponsesTerminal({ type: 'response.completed', response: {} }, state)
    expect(responsesStreamStatus(true, true, state)).toBe('error')
  })

  it('keys off upstream.ok for non-Responses providers regardless of terminals', () => {
    const state = newResponsesStreamState()
    expect(responsesStreamStatus(true, false, state)).toBe('success')
    expect(responsesStreamStatus(false, false, state)).toBe('error')
  })

  it('is always an error when the upstream response was not ok', () => {
    const state = newResponsesStreamState()
    noteResponsesTerminal({ type: 'response.completed', response: {} }, state)
    expect(responsesStreamStatus(false, true, state)).toBe('error')
  })
})

describe('classifyUpstreamFailure model scoping', () => {
  const rateLimited = (headers?: Record<string, string>) =>
    new Response(JSON.stringify({ error: { message: 'usage limit reached for this model' } }), {
      status: 429,
      headers,
    })

  it('marks an OpenAI 429 without Codex quota headers as model-scoped', async () => {
    const failure = await classifyUpstreamFailure('openai', rateLimited())
    expect(failure.penalty).toBe('rate_limited')
    expect(failure.modelScoped).toBe(true)
  })

  it('keeps an OpenAI 429 with account-window evidence account-wide', async () => {
    const failure = await classifyUpstreamFailure(
      'openai',
      rateLimited({
        'x-codex-primary-used-percent': '100',
        'x-codex-primary-over-secondary-limit': 'true',
        'x-codex-primary-window-minutes': '300',
        'x-codex-primary-reset-after-seconds': '600',
      }),
    )
    expect(failure.penalty).toBe('rate_limited')
    expect(failure.modelScoped).not.toBe(true)
  })

  it('keeps Spark quota exhaustion model-scoped even with account quota headers', async () => {
    const failure = await classifyUpstreamFailure(
      'openai',
      rateLimited({
        'x-codex-primary-used-percent': '100',
        'x-codex-primary-window-minutes': '10080',
        'x-codex-primary-reset-after-seconds': '604800',
      }),
      'gpt-5.3-codex-spark',
    )
    expect(isOpenaiSparkModel('gpt-5.3-codex-spark-high')).toBe(true)
    expect(failure).toMatchObject({
      penalty: 'rate_limited',
      retryable: true,
      modelScoped: true,
      accountScoped: false,
    })
    expect(failure.resetAt).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60_000)
  })

  it('marks an OpenAI rate-limit-shaped 400 as model-scoped', async () => {
    const response = new Response(
      JSON.stringify({ error: { message: 'usage limit reached for gpt-5.6-luna' } }),
      { status: 400 },
    )
    const failure = await classifyUpstreamFailure('openai', response)
    expect(failure.penalty).toBe('rate_limited')
    expect(failure.modelScoped).toBe(true)
  })

  it('treats an OpenAI usage_limit_reached body as account-scoped', async () => {
    const before = Date.now()
    const failure = await classifyUpstreamFailure(
      'openai',
      new Response(JSON.stringify({
        error: {
          type: 'usage_limit_reached',
          message: 'The usage limit has been reached',
          resets_in_seconds: 3600,
        },
      }), { status: 429 }),
    )

    expect(failure).toMatchObject({
      penalty: 'rate_limited',
      retryable: true,
      modelScoped: false,
      accountScoped: true,
    })
    expect(failure.resetAt).toBeGreaterThanOrEqual(before + 3_599_000)
    expect(failure.resetAt).toBeLessThanOrEqual(Date.now() + 3_601_000)
  })

  it('uses a human-readable OpenCode usage reset duration', async () => {
    const before = Date.now()
    const failure = await classifyUpstreamFailure(
      'openai',
      new Response(JSON.stringify({
        error: {
          type: 'GoUsageLimitError',
          message: '5-hour usage limit reached. Resets in 4hr 59min.',
        },
      }), { status: 429 }),
    )

    expect(failure.modelScoped).toBe(false)
    expect(failure.accountScoped).toBe(true)
    expect(failure.resetAt).toBeGreaterThanOrEqual(before + (4 * 60 + 59) * 60_000 - 1_000)
    expect(failure.resetAt).toBeLessThanOrEqual(Date.now() + (4 * 60 + 59) * 60_000 + 1_000)
  })

  it('does not use a healthy Codex snapshot to classify a 429 as account exhaustion', async () => {
    const failure = await classifyUpstreamFailure(
      'openai',
      rateLimited({
        'x-codex-primary-used-percent': '37',
        'x-codex-primary-reset-after-seconds': '604800',
        'x-codex-primary-window-minutes': '10080',
      }),
    )

    expect(failure.modelScoped).toBe(true)
    expect(failure.resetAt).toBeNull()
  })

  it('never marks non-OpenAI providers as model-scoped', async () => {
    const failure = await classifyUpstreamFailure('claude', rateLimited())
    expect(failure.penalty).toBe('rate_limited')
    expect(failure.modelScoped).not.toBe(true)
  })

  it('keeps 5xx failures account-wide', async () => {
    const failure = await classifyUpstreamFailure('openai', new Response('oops', { status: 502 }))
    expect(failure.penalty).toBe('error')
    expect(failure.modelScoped).not.toBe(true)
  })
})

describe('Sub2API account-scoped failure rotation', () => {
  it.each([400, 402, 403, 429])(
    'rotates away from an account that reports INSUFFICIENT_BALANCE with HTTP %i',
    async (status) => {
      const response = new Response(JSON.stringify({
        code: 'INSUFFICIENT_BALANCE',
        message: 'Insufficient account balance',
      }), { status })

      const failure = await classifyUpstreamFailure('sub2api', response)

      expect(failure).toMatchObject({
        penalty: 'rate_limited',
        retryable: true,
        accountScoped: true,
      })
      expect(shouldRetrySameRelayAccount(failure)).toBe(false)
    },
  )

  it('keeps retrying the same relay account for a transient 5xx', async () => {
    const failure = await classifyUpstreamFailure(
      'sub2api',
      new Response('temporary backend failure', { status: 502 }),
    )

    expect(shouldRetrySameRelayAccount(failure)).toBe(true)
  })
})

describe('Kimi 403 concurrency classification', () => {
  it('treats the provider concurrency response as a temporary account failure', async () => {
    const failure = await classifyUpstreamFailure(
      'kimi',
      new Response(JSON.stringify({
        error: {
          message: "You've reached your concurrent request limit. Please wait for your ongoing requests to finish and try again.",
        },
      }), { status: 403 }),
    )

    expect(failure).toMatchObject({
      penalty: 'rate_limited',
      retryable: true,
      accountScoped: true,
    })
    expect(failure.modelScoped).not.toBe(true)
  })

  it('keeps a near-match Kimi permission response non-retryable', async () => {
    const failure = await classifyUpstreamFailure(
      'kimi',
      new Response(JSON.stringify({
        error: { message: "You've reached your concurrent request limit. Please contact support." },
      }), { status: 403 }),
    )

    expect(failure.retryable).toBe(false)
    expect(failure.penalty).toBeNull()
  })
})

describe('redactUrls (relay-to-relay error sanitization)', () => {
  it('replaces http(s) URLs while keeping the surrounding message', () => {
    expect(
      redactUrls('backend https://inner.example.com:8443/v1/messages?ch=3 returned 502'),
    ).toBe('backend [redacted-url] returned 502')
  })

  it('redacts multiple URLs and leaves plain text untouched', () => {
    expect(redactUrls('a http://x.io/1 b HTTPS://y.io/2 c')).toBe(
      'a [redacted-url] b [redacted-url] c',
    )
    expect(redactUrls('quota exceeded')).toBe('quota exceeded')
  })
})

describe('isAnthropicFableOnlyWindowExceeded', () => {
  it('detects a model-scoped Fable 7d_oi limit without account-window exhaustion', () => {
    expect(
      isAnthropicFableOnlyWindowExceeded(
        new Headers({
          'anthropic-ratelimit-unified-7d_oi-utilization': '1',
          'anthropic-ratelimit-unified-7d_oi-surpassed-threshold': 'true',
          'anthropic-ratelimit-unified-5h-utilization': '0.2',
          'anthropic-ratelimit-unified-7d-utilization': '0.4',
        }),
      ),
    ).toBe(true)
  })

  it('does not classify mixed account-window exhaustion as Fable-only', () => {
    expect(
      isAnthropicFableOnlyWindowExceeded(
        new Headers({
          'anthropic-ratelimit-unified-7d_oi-utilization': '1',
          'anthropic-ratelimit-unified-5h-surpassed-threshold': 'true',
        }),
      ),
    ).toBe(false)
  })

  it('requires a Fable model when a model is supplied', () => {
    const headers = new Headers({
      'anthropic-ratelimit-unified-7d_oi-utilization': '1',
      'anthropic-ratelimit-unified-7d_oi-reset': String(Date.now() + 60_000),
    })
    expect(isAnthropicFableModel('claude-fable-5-1')).toBe(true)
    expect(isAnthropicFableModel('claude-fable-5')).toBe(true)
    expect(isAnthropicFableModel('claude-mythos-5')).toBe(true)
    expect(isAnthropicFableModel('claude-sonnet-5')).toBe(false)
    expect(isAnthropicFableOnlyWindowExceeded(headers, 'claude-fable-5')).toBe(true)
    expect(isAnthropicFableOnlyWindowExceeded(headers, 'claude-sonnet-5')).toBe(false)
  })

  it('classifies a Fable-only 429 as a model-scoped cooldown', async () => {
    const resetAt = Date.now() + 60_000
    const failure = await classifyUpstreamFailure(
      'claude',
      new Response(JSON.stringify({ error: { message: 'Fable quota reached' } }), {
        status: 429,
        headers: {
          'anthropic-ratelimit-unified-7d_oi-utilization': '1',
          'anthropic-ratelimit-unified-7d_oi-reset': String(resetAt),
        },
      }),
      'claude-fable-5',
    )

    expect(failure).toMatchObject({
      penalty: 'rate_limited',
      retryable: true,
      modelScoped: true,
      accountScoped: false,
    })
    expect(failure.resetAt).toBeGreaterThanOrEqual(resetAt - 1_000)
  })
})

describe('classifyBufferedResponsesFailure', () => {
  const failedSse = (error: Record<string, unknown>) => [
    `data: ${JSON.stringify({ type: 'response.created', response: { id: 'r1' } })}`,
    '',
    `data: ${JSON.stringify({ type: 'response.failed', response: { error } })}`,
    '',
  ].join('\n')

  it('treats a pre-output capacity terminal as retryable', async () => {
    const failure = await classifyBufferedResponsesFailure(
      'openai',
      failedSse({ code: 'server_error', message: 'capacity unavailable' }),
    )
    expect(failure).toMatchObject({ penalty: 'rate_limited', retryable: true })
  })

  it('keeps a buffered Spark rate-limit terminal model-scoped', async () => {
    const failure = await classifyBufferedResponsesFailure(
      'openai',
      failedSse({ code: 'rate_limit_exceeded', message: 'Spark quota reached' }),
      'gpt-5.3-codex-spark',
    )
    expect(failure).toMatchObject({ modelScoped: true, accountScoped: false })
  })

  it('recognizes a reset-bearing terminal as account quota exhaustion', async () => {
    const failure = await classifyBufferedResponsesFailure(
      'openai',
      failedSse({
        type: 'GoUsageLimitError',
        message: 'usage limit reached',
        resets_in_seconds: 3600,
      }),
      'gpt-5.5',
    )
    expect(failure).toMatchObject({
      penalty: 'rate_limited',
      retryable: true,
      modelScoped: false,
      accountScoped: true,
    })
  })

  it('keeps transient buffered failures retryable on relay-to-relay accounts', async () => {
    const failure = await classifyBufferedResponsesFailure(
      'sub2api',
      failedSse({ code: 'server_error', message: 'temporary backend failure' }),
    )
    expect(failure).toMatchObject({ penalty: 'error', retryable: true })
    expect(failure?.accountScoped).not.toBe(true)
    expect(shouldRetrySameRelayAccount(failure!)).toBe(true)
  })

  it('does not retry cyber policy terminals', async () => {
    const failure = await classifyBufferedResponsesFailure(
      'openai',
      failedSse({ code: 'cyber_policy', message: 'blocked by policy' }),
    )
    expect(failure).toMatchObject({ penalty: null, retryable: false })
  })

  it('does not retry policy text that happens to mention quota exhaustion', async () => {
    const failure = await classifyBufferedResponsesFailure(
      'openai',
      failedSse({ code: 'cyber_policy', message: 'policy quota exceeded' }),
    )
    expect(failure).toMatchObject({ penalty: null, retryable: false })
  })

  it('does not fail over a non-policy invalid-request terminal', async () => {
    const failure = await classifyBufferedResponsesFailure(
      'openai',
      failedSse({ code: 'invalid_request_error', message: 'unsupported field quota exceeded' }),
    )
    expect(failure).toMatchObject({ penalty: null, retryable: false })
  })

  it('does not propose failover after visible output', async () => {
    const failure = await classifyBufferedResponsesFailure(
      'openai',
      [
        'data: {"type":"response.output_text.delta","delta":"partial"}',
        '',
        'data: {"type":"response.failed","response":{"error":{"code":"server_error","message":"boom"}}}',
        '',
      ].join('\n'),
    )
    expect(failure).toBeNull()
  })
})
