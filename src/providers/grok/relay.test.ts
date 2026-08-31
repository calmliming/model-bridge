import { describe, expect, it } from 'vitest'
import {
  mapGrokModel,
  grokFunctionParametersHaveInvalidUnionRoot,
  normalizeGrokChatCompletionsBody,
  normalizeGrokResponsesBody,
  sanitizeGrokResponsesTools,
} from './relay'

describe('mapGrokModel', () => {
  it('resolves bare/aliased names to concrete xAI model ids', () => {
    expect(mapGrokModel('grok')).toBe('grok-4.5')
    expect(mapGrokModel('grok-latest')).toBe('grok-4.5')
    expect(mapGrokModel('grok-build')).toBe('grok-build-0.1')
  })

  it('passes concrete model ids through untouched', () => {
    expect(mapGrokModel('grok-4.6-latest')).toBe('grok-4.6')
    expect(mapGrokModel('grok-4.6')).toBe('grok-4.6')
    expect(mapGrokModel('grok-4.3')).toBe('grok-4.3')
    expect(mapGrokModel('grok-build-0.1')).toBe('grok-build-0.1')
  })

  it('defaults empty/non-string input to the flagship', () => {
    expect(mapGrokModel('')).toBe('grok-4.5')
    expect(mapGrokModel(undefined as unknown as string)).toBe('grok-4.5')
  })
})

describe('normalizeGrokResponsesBody', () => {
  it('forces stream/store and strips unsupported fields, keeping reasoning', () => {
    const out = normalizeGrokResponsesBody({
      model: 'grok-4.5',
      prompt_cache_retention: '24h',
      safety_identifier: 'abc',
      reasoning: { effort: 'high' },
    })
    expect(out.stream).toBe(true)
    expect(out.store).toBe(false)
    expect(out.prompt_cache_retention).toBeUndefined()
    expect(out.safety_identifier).toBeUndefined()
    expect(out.reasoning).toEqual({ effort: 'high' })
  })

  it('strips metadata after promoting a structured session to prompt_cache_key', () => {
    const out = normalizeGrokResponsesBody({
      model: 'grok-4.6',
      metadata: { user_id: JSON.stringify({ session_id: 'parent-session' }) },
    })
    expect(out.metadata).toBeUndefined()
    expect(out.prompt_cache_key).toBe('parent-session')
  })

  it('repairs mixed root unions and disables strict mode', () => {
    const out = normalizeGrokResponsesBody({
      model: 'grok-4.6',
      tools: [{
        type: 'function',
        name: 'update',
        strict: true,
        parameters: {
          type: 'object',
          oneOf: [{ type: 'object', properties: {} }, { type: 'null' }],
        },
      }],
    })
    expect(grokFunctionParametersHaveInvalidUnionRoot({
      type: 'object',
      oneOf: [{ type: 'object' }, { type: 'null' }],
    })).toBe(true)
    expect(out.tools).toEqual([{
      type: 'function',
      name: 'update',
      strict: false,
      parameters: { type: 'object', properties: {}, additionalProperties: true },
    }])
  })

  it('preserves an object-only union and does not mutate the input', () => {
    const parameters = {
      type: 'object',
      anyOf: [{ type: 'object', properties: { a: { type: 'string' } } }, { type: 'object' }],
    }
    const tools = [{ type: 'function', name: 'ok', parameters }]
    const out = sanitizeGrokResponsesTools(tools)
    expect(grokFunctionParametersHaveInvalidUnionRoot(parameters)).toBe(false)
    expect(out).toEqual(tools)
    expect(out).not.toBe(tools)
  })
})

describe('normalizeGrokChatCompletionsBody', () => {
  it('requests usage on streamed responses', () => {
    const out = normalizeGrokChatCompletionsBody({ model: 'grok-4.3', stream: true })
    expect(out.stream_options).toEqual({ include_usage: true })
  })

  it('leaves non-streaming bodies without stream_options', () => {
    const out = normalizeGrokChatCompletionsBody({ model: 'grok-4.3' })
    expect(out.stream_options).toBeUndefined()
  })
})
