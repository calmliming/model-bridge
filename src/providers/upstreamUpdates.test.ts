import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../http/upstream', () => ({ fetchWithConnectTimeout: mocks.fetch }))
vi.mock('../config', async original => {
  const { config } = await original<typeof import('../config')>()
  return { config: { ...config, ANTIGRAVITY_API_HOST: 'daily-cloudcode-pa.googleapis.com' } }
})
import { normalizeClaudeMessagesBody, relayClaudeMessages } from './claude/relay'
import { sanitizeGeminiBody } from './gemini/relay'
import { fetchAntigravityModels } from './antigravity/quota'
import { messagesToGemini, prepareAntigravityGemini } from './antigravity/converter'
import { resolveAntigravityModel } from './antigravity/model'
import { listModelIdsForKey } from './modelDiscovery'

beforeEach(() => { vi.clearAllMocks(); mocks.fetch.mockResolvedValue(Response.json({ models: {} })) })

describe('Sub2API v0.2.16 model compatibility', () => {
  it.each(['claude-haiku-5-5', 'claude-haiku-5.5'])('adapts %s while preserving forced tools', model => {
    const body = { model, temperature: 0.5, top_p: 0.7, top_k: 10,
      thinking: { type: 'enabled', budget_tokens: 1024 },
      messages: [{ role: 'user', content: 'Use the tool' }],
      tools: [{ name: 'lookup', input_schema: { type: 'object' } }], tool_choice: { type: 'tool', name: 'lookup' } }
    const normalized = normalizeClaudeMessagesBody(body)
    expect(normalized).toMatchObject({ tool_choice: body.tool_choice, tools: body.tools, messages: body.messages })
    for (const key of ['temperature', 'top_p', 'top_k', 'thinking']) expect(normalized).not.toHaveProperty(key)
    expect(body.thinking.type).toBe('enabled')
  })

  it.each(['low', 'medium', 'high'])('preserves disabled thinking at %s effort', effort => {
    expect(normalizeClaudeMessagesBody({ model: 'claude-haiku-5-5', thinking: { type: 'disabled' }, output_config: { effort } }))
      .toMatchObject({ thinking: { type: 'disabled' }, output_config: { effort } })
  })
  it.each(['xhigh', 'max'])('uses adaptive thinking at %s effort', effort => {
    expect(normalizeClaudeMessagesBody({ model: 'claude-haiku-5-5', thinking: { type: 'disabled' }, output_config: { effort } }))
      .not.toHaveProperty('thinking')
  })
  it('filters conflicting streaming beta for Haiku toolsets without rewriting native history', async () => {
    const body = { model: 'claude-haiku-5-5', tools: [{ type: 'computer_toolset_20260801' }],
      messages: [{ role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'signed' }] }] }
    await relayClaudeMessages('test', body, { 'user-agent': 'claude-cli/2.1.0',
      'anthropic-beta': 'fine-grained-tool-streaming-2025-05-14,future-feature' })
    const init = mocks.fetch.mock.calls[0]![1]
    expect(JSON.parse(init.body)).toEqual(body)
    expect(init.headers['anthropic-beta']).not.toContain('fine-grained-tool-streaming')
    expect(init.headers['anthropic-beta']).toContain('future-feature')
  })
  it('lists both new models through native and aggregator model discovery', () => {
    for (const [provider, model] of [['claude', 'claude-haiku-5-5'], ['gemini', 'gemini-4-argon']] as const) {
      expect(listModelIdsForKey({ allowedProviders: [provider], allowedModels: null })).toContain(model)
      expect(listModelIdsForKey({ allowedProviders: ['sub2api'], allowedModels: null })).toContain(model)
    }
  })
})

describe('Gemini 4 Argon and Antigravity', () => {
  it.each([0, 4096, 20000])('maps numeric budget %s to a supported level', budget => {
    const body = { generationConfig: { temperature: 0.1, topP: 0.5, maxOutputTokens: 16000,
      thinkingConfig: { thinkingBudget: budget, includeThoughts: true } } }
    const result = sanitizeGeminiBody(body, 'gemini-4-argon-high')
    expect(result).toEqual({ generationConfig: { maxOutputTokens: 16000,
      thinkingConfig: { thinkingLevel: budget === 0 ? 'low' : budget === 4096 ? 'medium' : 'high', includeThoughts: true } } })
    expect(body.generationConfig.thinkingConfig.thinkingBudget).toBe(budget)
  })
  it('accepts snake-case config and keeps an explicit thinking level', () => {
    expect(sanitizeGeminiBody({ generation_config: { top_k: 2, thinking_config: { thinking_budget: 4096, thinking_level: 'high' } } }, 'models/gemini-4-argon'))
      .toEqual({ generation_config: { thinking_config: { thinking_level: 'high' } } })
  })
  it('rejects explicit cache references before making an upstream request', () => {
    for (const key of ['cachedContent', 'cached_content']) {
      expect(() => sanitizeGeminiBody({ [key]: 'cachedContents/123' }, 'gemini-4-argon'))
        .toThrowError(expect.objectContaining({ code: 'unsupported_explicit_cache', statusCode: 400 }))
    }
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('discovers models on the configured generation endpoint', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ models: { 'gemini-4-argon-high': {} } }))
    const result = await fetchAntigravityModels('test', 'project')
    expect(mocks.fetch.mock.calls[0]![0]).toBe('https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels')
    expect(resolveAntigravityModel('gemini-4-argon', result.models, 'high')).toBe('gemini-4-argon-high')
  })
  it('keeps tool-result images and native function-call signatures intact', () => {
    const source = { type: 'base64', media_type: 'image/png', data: 'AA==' }
    const converted = messagesToGemini({ messages: [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call', name: 'screen', input: {}, signature: 'sig' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call', content: [{ type: 'image', source }] }] },
    ] }, 'gemini-4-argon')
    expect(JSON.stringify(converted)).toContain('"inlineData":{"mimeType":"image/png","data":"AA=="}')
    const native = { contents: [{ role: 'model', parts: [{ functionCall: { id: 'call', name: 'screen', args: {} }, thoughtSignature: 'sig' }] }] }
    expect(prepareAntigravityGemini(native, 'gemini-4-argon').contents).toEqual(native.contents)
  })
})
