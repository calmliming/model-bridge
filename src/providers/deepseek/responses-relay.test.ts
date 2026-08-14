import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeDeepseekResponsesBody, relayDeepseekResponses } from './responses-relay'

afterEach(() => vi.unstubAllGlobals())

describe('normalizeDeepseekResponsesBody', () => {
  it('preserves V4 Pro and keeps native Responses tools intact', () => {
    const out = normalizeDeepseekResponsesBody({
      model: 'deepseek-v4-pro',
      input: 'search the docs',
      tools: [{ type: 'web_search' }, { type: 'custom', name: 'apply_patch' }],
      user: 'client-user',
      stream: false,
    })
    expect(out).toMatchObject({
      model: 'deepseek-v4-pro',
      stream: false,
      tools: [{ type: 'web_search' }, { type: 'custom', name: 'apply_patch' }],
      user: 'client-user',
    })
  })

  it('calls the native Responses URL as JSON for non-streaming requests', async () => {
    const fetchMock = vi.fn(async () => new Response('data: {}\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await relayDeepseekResponses('sk-test', { model: 'deepseek-v4-pro', input: 'hi' })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/v1/responses')
    expect(init.headers).toMatchObject({ authorization: 'Bearer sk-test', accept: 'application/json' })
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'deepseek-v4-pro', stream: false })
  })

  it('requests SSE when the client enables streaming', async () => {
    const fetchMock = vi.fn(async () => new Response('data: {}\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await relayDeepseekResponses('sk-test', {
      model: 'deepseek-v4-flash',
      input: 'hi',
      stream: true,
    })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).toMatchObject({ accept: 'text/event-stream' })
    expect(JSON.parse(String(init.body))).toMatchObject({ stream: true })
  })
})
