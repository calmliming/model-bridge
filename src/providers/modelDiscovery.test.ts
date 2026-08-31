import { describe, expect, it } from 'vitest'
import { isProviderAllowed, listGeminiModels, listModelIdsForKey } from './modelDiscovery'

describe('model discovery', () => {
  it('returns all default models for unrestricted keys', () => {
    const models = listModelIdsForKey({ allowedProviders: null, allowedModels: null })
    expect(models).toEqual(
      expect.arrayContaining([
        'gpt-5.5',
        'claude-sonnet-5',
        'gemini-3.6-flash',
        'mimo-v2.5-pro',
        'glm-5.3',
        'qwen3.8-max',
        'deepseek-v4-pro',
      ]),
    )
    expect(models).not.toEqual(expect.arrayContaining([
      'gemini-3-pro-preview',
      'glm-5.1',
      'qwen3-coder-plus',
      'deepseek-chat',
      'deepseek-reasoner',
    ]))
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
      'gpt-5.3-codex-spark',
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
      'gpt-5.3-codex-spark',
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
      'gpt-5.3-codex-spark',
      'gpt-image-2',
      'gpt-public',
    ])
  })

  it('discovers Kimi Code K3 aliases for Kimi-scoped keys', () => {
    const key = { allowedProviders: ['kimi'] as const, allowedModels: null }
    expect(listModelIdsForKey(key)).toEqual([
      'kimi-k3',
      'kimi-k2.7-code',
      'kimi-k2.6',
      'k3',
      'k3-256k',
      'kimi-code/k3',
    ])
  })

  it('returns Gemini API model objects', () => {
    const key = { allowedProviders: ['gemini'] as const, allowedModels: ['gemini-*'] }
    expect(listGeminiModels(key)).toEqual([
      {
        name: 'models/gemini-3.6-flash',
        version: '001',
        displayName: 'Gemini 3.6 Flash',
        supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
      },
      {
        name: 'models/gemini-3.1-pro-preview',
        version: '001',
        displayName: 'Gemini 3.1 Pro Preview',
        supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
      },
      {
        name: 'models/gemini-3.5-flash',
        version: '001',
        displayName: 'Gemini 3.5 Flash',
        supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
      },
      {
        name: 'models/gemini-3.5-flash-lite',
        version: '001',
        displayName: 'Gemini 3.5 Flash Lite',
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
