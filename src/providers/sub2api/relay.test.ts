import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeSub2ApiBaseUrl, relaySub2ApiGemini, relaySub2ApiMessages, relaySub2ApiResponses, relaySub2ApiChatCompletions } from './relay'

const upstream = vi.hoisted(() => vi.fn())
vi.mock('../../http/upstream', () => ({ fetchWithConnectTimeout: upstream }))
afterEach(() => vi.resetAllMocks())

describe('Sub2API Antigravity endpoints', () => {
  it.each(['/antigravity', '/antigravity/', '/antigravity/v1/', '/antigravity/v1beta/'])('normalizes %s without losing the dedicated prefix', suffix => {
    expect(normalizeSub2ApiBaseUrl(`https://gateway.example${suffix}`)).toBe('https://gateway.example/antigravity')
  })
  it.each(['?token=secret', '#fragment'])('rejects ambiguous base URL suffix %s', suffix => {
    expect(() => normalizeSub2ApiBaseUrl(`https://gateway.example/antigravity${suffix}`)).toThrow()
  })
  it('uses the dedicated Gemini streaming route and preserves signed history', async () => {
    upstream.mockResolvedValue(new Response('{}'))
    const body = { contents: [{ role: 'model', parts: [{ text: 'thought', thought: true, thoughtSignature: 'signed' }] }] }
    await relaySub2ApiGemini('key', 'https://gateway.example/antigravity/v1beta/', body, 'gemini-3.8-flash', 'streamGenerateContent')
    expect(upstream).toHaveBeenCalledWith('https://gateway.example/antigravity/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse',
      expect.objectContaining({ body: JSON.stringify(body), headers: expect.objectContaining({ authorization: 'Bearer key', 'x-goog-api-key': 'key' }) }), 60000)
  })
  it('forwards Claude-compatible requests to the dedicated Messages path', async () => {
    upstream.mockResolvedValue(new Response('{}'))
    await relaySub2ApiMessages('key', 'https://gateway.example/antigravity', { model: 'claude-sonnet-5', messages: [] })
    expect(upstream.mock.calls[0]?.[0]).toBe('https://gateway.example/antigravity/v1/messages')
  })
  it('explains unsupported dedicated Chat/Responses routes without calling upstream', async () => {
    for (const relay of [relaySub2ApiResponses, relaySub2ApiChatCompletions]) {
      const response = await relay('key', 'https://gateway.example/antigravity', {})
      expect(response.status).toBe(400)
      expect((await response.json() as { error: { code: string } }).error.code).toBe('antigravity_endpoint_unsupported')
    }
    expect(upstream).not.toHaveBeenCalled()
  })
})
