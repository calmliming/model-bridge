import { describe, expect, it } from 'vitest'
import { isProviderAllowed, listGeminiModels, listModelIdsForKey } from './modelDiscovery'

describe('model discovery', () => {
  it('returns all default models for unrestricted keys', () => {
    expect(listModelIdsForKey({ allowedProviders: null, allowedModels: null })).toEqual(
      expect.arrayContaining(['gpt-5.5', 'claude-sonnet-5', 'gemini-2.5-flash', 'deepseek-v4-pro']),
    )
  })

  it('honors provider restrictions', () => {
    const key = { allowedProviders: ['openai'] as const, allowedModels: null }
    expect(isProviderAllowed('openai', key)).toBe(true)
    expect(isProviderAllowed('deepseek', key)).toBe(false)
    expect(listModelIdsForKey(key)).toEqual([
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex',
      'gpt-image-2',
    ])
  })

  it('honors exact and wildcard model restrictions', () => {
    const key = { allowedProviders: null, allowedModels: ['gpt-*', 'deepseek-v4-pro'] }
    expect(listModelIdsForKey(key)).toEqual([
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex',
      'gpt-image-2',
      'deepseek-v4-pro',
    ])
  })

  it('includes custom exact models when the provider can be inferred', () => {
    const key = { allowedProviders: null, allowedModels: ['gpt-custom'] }
    expect(listModelIdsForKey(key)).toEqual(['gpt-custom'])
  })

  it('includes client-facing model mapping names', () => {
    const key = {
      allowedProviders: ['openai'] as const,
      allowedModels: null,
      modelMappings: { 'gpt-public': 'gpt-5.4' },
    }
    expect(listModelIdsForKey(key)).toEqual([
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex',
      'gpt-image-2',
      'gpt-public',
    ])
  })

  it('returns Gemini API model objects', () => {
    const key = { allowedProviders: ['gemini'] as const, allowedModels: ['gemini-*'] }
    expect(listGeminiModels(key)).toEqual([
      {
        name: 'models/gemini-3-pro-preview',
        version: '001',
        displayName: 'Gemini 3 Pro Preview',
        supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
      },
      {
        name: 'models/gemini-3-flash-preview',
        version: '001',
        displayName: 'Gemini 3 Flash Preview',
        supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
      },
      {
        name: 'models/gemini-2.5-pro',
        version: '001',
        displayName: 'Gemini 2.5 Pro',
        supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
      },
      {
        name: 'models/gemini-2.5-flash',
        version: '001',
        displayName: 'Gemini 2.5 Flash',
        supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
      },
    ])
  })
})
