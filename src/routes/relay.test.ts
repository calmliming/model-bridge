import { describe, expect, it } from 'vitest'
import {
  classifyUpstreamFailure,
  isAnthropicFableOnlyWindowExceeded,
  newResponsesStreamState,
  noteResponsesTerminal,
  redactUrls,
  responsesStreamStatus,
} from './relay'

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

  it('marks an OpenAI rate-limit-shaped 400 as model-scoped', async () => {
    const response = new Response(
      JSON.stringify({ error: { message: 'usage limit reached for gpt-5.6-luna' } }),
      { status: 400 },
    )
    const failure = await classifyUpstreamFailure('openai', response)
    expect(failure.penalty).toBe('rate_limited')
    expect(failure.modelScoped).toBe(true)
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
})
