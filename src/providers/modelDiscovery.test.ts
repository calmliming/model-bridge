import { describe, expect, it } from 'vitest'
import { isProviderAllowed, listGeminiModels, listModelIdsForKey, listOpenAIStyleModels } from './modelDiscovery'
const image25Models = ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare-2026-09-08', 'gpt-image-2.5-sunburst-2026-09-08']

describe('model discovery', () => {
  it('advertises V4.1 Flash while keeping explicit legacy names discoverable', () => {
    expect(listModelIdsForKey({ allowedProviders: ['deepseek'], allowedModels: null }))
      .toEqual(['deepseek-flash', 'deepseek-v4-pro'])
    const legacy = ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']
    expect(listModelIdsForKey({ allowedProviders: ['deepseek'], allowedModels: legacy })).toEqual(legacy)
  })
  it('discovers cross-provider aliases under the mapped provider', () => {
    const key = {
      allowedProviders: ['openai'], allowedModels: ['deepseek-v4-pro'],
      modelMappings: { 'deepseek-v4-pro': 'gpt-5.4' },
    }
    expect(listModelIdsForKey(key, 'openai')).toEqual(['deepseek-v4-pro'])
    expect(listOpenAIStyleModels(key)[0]).toMatchObject({ id: 'deepseek-v4-pro', owned_by: 'openai' })
  })

  it('hides both curated and custom aliases whose mapped provider is forbidden', () => {
    const key = {
      allowedProviders: ['deepseek'], allowedModels: ['deepseek-v4-pro', 'deepseek-custom'],
      modelMappings: { 'deepseek-v4-pro': 'gpt-5.4', 'deepseek-custom': 'gpt-5.4' },
    }
    expect(listModelIdsForKey(key)).toEqual([])
  })
  it('returns all default models for unrestricted keys', () => {
    const models = listModelIdsForKey({ allowedProviders: null, allowedModels: null })
    expect(models).toEqual(
      expect.arrayContaining([
        'gpt-5.5',
        'claude-fable-5-1',
        'claude-sonnet-5',
        'gemini-3.8-flash',
        'gemini-3.6-flash',
        'mimo-v2.5-pro',
        'glm-5.3',
        'qwen3.8-max',
        'deepseek-v4-pro',
      ]),
    )
    expect(models).not.toEqual(expect.arrayContaining([
      'claude-mythos-5-1',
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
      'gpt-6-astra',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex',
      'gpt-5.3-codex-spark',
      'gpt-image-2',
      ...image25Models,
    ])
  })

  it('honors exact and wildcard model restrictions', () => {
    const key = { allowedProviders: null, allowedModels: ['gpt-*', 'deepseek-v4-pro'] }
    expect(listModelIdsForKey(key)).toEqual([
      'gpt-6-astra',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex',
      'gpt-5.3-codex-spark',
      'gpt-image-2',
      ...image25Models,
      'deepseek-v4-pro',
    ])
  })

  it('includes custom exact models when the provider can be inferred', () => {
    const key = { allowedProviders: null, allowedModels: ['gpt-custom'] }
    expect(listModelIdsForKey(key)).toEqual(['gpt-custom'])
  })

  it('only exposes limited-access Claude models when explicitly allowed', () => {
    const key = {
      allowedProviders: ['claude'] as const,
      allowedModels: ['claude-mythos-5-1'],
    }
    expect(listModelIdsForKey(key)).toEqual(['claude-mythos-5-1'])
  })

  it('includes client-facing model mapping names', () => {
    const key = {
      allowedProviders: ['openai'] as const,
      allowedModels: null,
      modelMappings: { 'gpt-public': 'gpt-5.4' },
    }
    expect(listModelIdsForKey(key)).toEqual([
      'gpt-6-astra',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex',
      'gpt-5.3-codex-spark',
      'gpt-image-2',
      ...image25Models,
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
        name: 'models/gemini-3.8-flash',
        version: '001',
        displayName: 'Gemini 3.8 Flash',
        supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
      },
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


describe('group model restrictions', () => {
  it('intersects group policy with key policy and filters aliases by their requested name', () => {
    const key = { allowedProviders: ['minimax'], allowedModels: ['MiniMax-M3', 'alias'],
      groupAllowedModels: ['minimax-*'], modelMappings: { alias: 'MiniMax-M3' } }
    expect(listModelIdsForKey(key)).toEqual(['MiniMax-M3'])
    expect(listModelIdsForKey({ ...key, groupAllowedModels: ['alias'] })).toEqual(['alias'])
    expect(listModelIdsForKey({ ...key, groupAllowedModels: [] })).toEqual([])
  })
  it('includes custom exact group entries without widening key restrictions', () => {
    expect(listModelIdsForKey({ allowedProviders: ['minimax'], allowedModels: null, groupAllowedModels: ['MiniMax-custom'] })).toEqual(['MiniMax-custom'])
    expect(listModelIdsForKey({ allowedProviders: ['minimax'], allowedModels: ['MiniMax-M3'], groupAllowedModels: ['MiniMax-custom'] })).toEqual([])
    expect(listModelIdsForKey({ allowedProviders: ['sub2api'], allowedModels: null })).toContain('MiniMax-M3')
    expect(listModelIdsForKey({ allowedProviders: ['sub2api'], allowedModels: null, groupAllowedModels: ['MiniMax-custom'] })).toEqual(['MiniMax-custom'])
    expect(listModelIdsForKey({ allowedProviders: ['sub2api'], allowedModels: null, groupAllowedModels: ['alias'], modelMappings: { alias: 'MiniMax-custom' } })).toEqual(['alias'])
  })
})


it('lists Gemini models through Sub2API while retaining group restrictions', () => {
  const key = { allowedProviders: ['sub2api'], allowedModels: null, groupAllowedModels: ['gemini-3.8-*'] }
  const models = listGeminiModels(key, 'sub2api')
  expect(models.map(x => x.name)).toEqual(['models/gemini-3.8-flash'])
  expect(listGeminiModels(key)).toEqual([])
})
