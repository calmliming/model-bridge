import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messagesToGemini, prepareAntigravityGemini } from './converter'
import { antigravitySseToMessages, createAntigravityMessagesTransform } from './response'
import { relayAntigravity } from './relay'
import { parseAntigravityModels } from './quota'
import { recallToolSignature, rememberToolSignature } from './signatures'
import { quotaPauseUntil, quotaWindowPauseUntil, accountQuotaFromMetadata } from '../../accounts/quota'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../../http/upstream', () => ({ fetchWithConnectTimeout: mocks.fetch }))
beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.useRealTimers())

const scope = { apiKeyId: 'key-1', accountId: 'account-1', model: 'claude-sonnet-5' }
const usage = { promptTokenCount: 100, cachedContentTokenCount: 30, candidatesTokenCount: 20, thoughtsTokenCount: 5 }
const sse = (items: unknown[]) => items.map(response => `data: ${JSON.stringify({ response })}\n\n`).join('')

describe('Antigravity Messages conversion', () => {
  it('keeps tool names, arguments, signed thinking and image input across turns', () => {
    const input = { model: scope.model, stream: true, max_tokens: 1000, system: 'System', messages: [
      { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA==' } }] },
      { role: 'assistant', content: [
        { type: 'thinking', thinking: 'Think', signature: 'thought-sig' },
        { type: 'tool_use', id: 'call-1', name: 'weather', input: { city: '北京' }, signature: 'tool-sig' },
      ] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'Sunny' }] },
    ], tools: [{ name: 'weather', input_schema: { type: 'object', properties: { city: { $ref: '#/$defs/city' } }, $defs: { city: { type: 'string' } } } }] }
    const result = messagesToGemini(input, scope.model)
    expect(result.stream).toBe(true)
    expect(result.systemInstruction).toEqual({ role: 'user', parts: [{ text: 'System' }] })
    expect(result.contents).toEqual([
      { role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: 'AA==' } }] },
      { role: 'model', parts: [{ text: 'Think', thought: true, thoughtSignature: 'thought-sig' },
        { functionCall: { id: 'call-1', name: 'weather', args: { city: '北京' } }, thoughtSignature: 'tool-sig' }] },
      { role: 'user', parts: [{ functionResponse: { id: 'call-1', name: 'weather', response: { result: 'Sunny' } } }] },
    ])
    expect(result.tools).toEqual([{ functionDeclarations: [{ name: 'weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } }] }])
  })

  it('keeps output above the thinking budget but below the upstream ceiling', () => {
    const result = messagesToGemini({ messages: [], max_tokens: 999999, thinking: { type: 'enabled', budget_tokens: 70000 } }, scope.model)
    expect(result.generationConfig).toEqual({ maxOutputTokens: 64000, thinkingConfig: { includeThoughts: true, thinkingBudget: 63999 } })
    expect(prepareAntigravityGemini({ contents: [] }, scope.model).toolConfig).toEqual({ functionCallingConfig: { mode: 'VALIDATED' } })
  })

  it.each([
    { messages: [{ role: 'assistant', content: [{ type: 'thinking', thinking: 'unsigned' }] }] },
    { messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'unknown', content: 'x' }] }] },
    { messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'url', url: 'https://private.example' } }] }] },
    { messages: [], tools: [{ name: 'web_search', type: 'web_search_20250305' }, { name: 'function' }] },
  ])('rejects unsupported request semantics before forwarding', body => {
    expect(() => messagesToGemini(body, scope.model)).toThrowError(expect.objectContaining({ statusCode: 400 }))
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})

describe('Antigravity response lifecycle', () => {
  it('translates streamed thoughts, text, tool calls and inclusive usage into Messages', () => {
    const text = sse([
      { candidates: [{ content: { parts: [{ text: 'Think', thought: true, thoughtSignature: 'sig-thinking' }] } }], usageMetadata: { promptTokenCount: 100 } },
      { candidates: [{ content: { parts: [{ text: 'Checking.' }, { functionCall: { id: 'tool-42', name: 'weather', args: { city: '北京' } }, thoughtSignature: 'sig-tool' }] }, finishReason: 'STOP' }], usageMetadata: usage },
    ])
    const result = antigravitySseToMessages(text, scope)
    expect(result.body).toMatchObject({ type: 'message', model: scope.model, stop_reason: 'tool_use', content: [
      { type: 'thinking', thinking: 'Think', signature: 'sig-thinking' }, { type: 'text', text: 'Checking.' },
      { type: 'tool_use', id: 'tool-42', name: 'weather', input: { city: '北京' }, signature: 'sig-tool' },
    ], usage: { input_tokens: 70, output_tokens: 25, cache_read_input_tokens: 30 } })
    expect(result.usage).toMatchObject({ inputTokens: 70, outputTokens: 25, reasoningTokens: 5, cacheReadTokens: 30 })
    expect(recallToolSignature(scope, 'tool-42')).toBe('sig-tool')
    expect(recallToolSignature({ ...scope, apiKeyId: 'other-key' }, 'tool-42')).toBeUndefined()
    expect(recallToolSignature({ ...scope, accountId: 'other-account' }, 'tool-42')).toBeUndefined()
  })

  it('does not declare success when the stream ends early or is blocked', () => {
    const result = antigravitySseToMessages(sse([{ candidates: [{ content: { parts: [{ text: 'partial' }] } }], usageMetadata: usage }]), scope)
    expect(result).toMatchObject({ status: 'error', httpStatus: 502, body: { error: { code: 'upstream_stream_closed' } } })
    expect(result.usage.outputTokens).toBe(25)
    const transform = createAntigravityMessagesTransform(scope)
    transform.transform({ response: { candidates: [{ finishReason: 'SAFETY' }] } })
    expect(transform.flush()).toContainEqual(expect.objectContaining({ type: 'error' }))
    expect(transform.status()).toBe('error')
    expect(transform.flush()).toEqual([])
  })

  it('retains a terminal event without a trailing blank SSE separator', () => {
    const result = antigravitySseToMessages(sse([{ candidates: [{ content: { parts: [{ text: 'done' }] }, finishReason: 'STOP' }], usageMetadata: usage }]).trimEnd(), scope)
    expect(result.body).toMatchObject({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] })
  })
})

describe('Antigravity transport and model quota', () => {
  it('sends the native envelope directly to Google with isolated sessions', async () => {
    mocks.fetch.mockResolvedValue(new Response('{}'))
    const body = { contents: [{ role: 'user', parts: [{ text: 'Hello' }] }], stream: true }
    await relayAntigravity('token', body, { ...scope, project: 'project-1', action: 'messages' })
    const [url, init] = mocks.fetch.mock.calls[0]!
    expect(url).toBe('https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse')
    const request = JSON.parse(init.body)
    expect(request).toMatchObject({ project: 'project-1', model: scope.model, userAgent: 'antigravity', requestType: 'agent', request: { contents: body.contents, toolConfig: { functionCallingConfig: { mode: 'VALIDATED' } } } })
    expect(request.request.stream).toBeUndefined()
    await relayAntigravity('token', body, { ...scope, apiKeyId: 'key-2', project: 'project-1', action: 'messages' })
    expect(JSON.parse(mocks.fetch.mock.calls[1]![1].body).request.sessionId).not.toBe(request.request.sessionId)
  })

  it('keeps quota exhaustion model scoped and persists a readable snapshot', () => {
    const now = Date.now()
    const { models, quota } = parseAntigravityModels({ models: {
      'gemini-3.8-flash': { quotaInfo: { remainingFraction: 0, resetTime: new Date(now + 3600000).toISOString() } },
      'claude-sonnet-5': { quotaInfo: { remainingFraction: 0.8, resetTime: new Date(now + 7200000).toISOString() } },
    } }, now)
    expect(models).toHaveLength(2)
    expect(quotaPauseUntil(quota, 90, now)).toBeNull()
    expect(quotaWindowPauseUntil(quota.windows[0]!, 90, now)).toBe(now + 3600000)
    expect(quotaWindowPauseUntil(quota.windows[1]!, 90, now)).toBeNull()
    expect(quotaWindowPauseUntil(quota.windows[1]!, 20, now)).toBe(now + 7200000)
    expect(accountQuotaFromMetadata({ quota })).toEqual(quota)
  })
})


it('keeps identically named tool calls isolated between conversations', () => {
  rememberToolSignature({ ...scope, sessionKeyHash: 'conversation-a' }, 'call-0', 'signature-a')
  rememberToolSignature({ ...scope, sessionKeyHash: 'conversation-b' }, 'call-0', 'signature-b')
  expect(recallToolSignature({ ...scope, sessionKeyHash: 'conversation-a' }, 'call-0')).toBe('signature-a')
  expect(recallToolSignature({ ...scope, sessionKeyHash: 'conversation-b' }, 'call-0')).toBe('signature-b')
  expect(recallToolSignature(scope, 'call-0')).toBeUndefined()
})
