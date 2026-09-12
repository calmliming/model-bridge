import { describe, expect, it } from 'vitest'
import { mergeCatalogModels, parseModelCatalog, readCatalogSnapshot } from './modelCatalog'
import { listOpenAIStyleModels } from './modelDiscovery'

describe('model catalog capability normalization', () => {
  it('reads Codex manifests and compatible lists without exposing unrelated fields', () => {
    const models = parseModelCatalog({ models: [{ slug: 'gpt-new', display_name: 'New model', context_window: 100000, max_context_window: 200000,
      input_modalities: ['text', 'image', 'secret'], supported_reasoning_levels: [{ effort: 'high', description: 'High' }], token: 'private', instructions: 'not a capability' },
      { slug: 'hidden', visibility: 'hide' }, { slug: 'unavailable', supported_in_api: false }] })
    expect(models).toEqual([{ id: 'gpt-new', display_name: 'New model', context_window: 100000, max_context_window: 200000,
      input_modalities: ['text', 'image'], supported_reasoning_levels: [{ effort: 'high', description: 'High' }] }])
    expect(parseModelCatalog({ data: [{ id: 'namespace/model' }, { id: 'namespace/model' }] })).toEqual([{ id: 'namespace/model' }])
    expect(readCatalogSnapshot({ modelCatalog: { version: 1, sourceKey: 'source', syncedAt: 10, models } }, 'source')?.models).toEqual(models)
    expect(readCatalogSnapshot({ modelCatalog: { version: 1, sourceKey: 'old', syncedAt: 10, models } }, 'new')).toBeNull()
  })
  it('distinguishes a valid empty catalog from an invalid response', () => {
    expect(parseModelCatalog({ data: [] })).toEqual([])
    expect(() => parseModelCatalog({ error: 'temporary failure' })).toThrow()
    expect(() => parseModelCatalog({ data: [{ id: '../private' }] })).toThrow()
    expect(() => parseModelCatalog({ data: Array(2001).fill({ id: 'model' }) })).toThrow()
  })
  it('does not overstate capabilities across accounts', () => {
    expect(mergeCatalogModels({ id: 'gpt-new', context_window: 200000, input_modalities: ['text', 'image'] },
      { id: 'gpt-new', context_window: 100000, input_modalities: ['text'] })).toMatchObject({ context_window: 100000, input_modalities: ['text'] })
    expect(mergeCatalogModels({ id: 'gpt-new', context_window: 200000 }, { id: 'gpt-new' })).not.toHaveProperty('context_window')
  })
  it('applies key/group restrictions to dynamic models, aliases and capabilities', () => {
    const key = { allowedProviders: ['openai'], allowedModels: ['public'], groupAllowedModels: ['public'],
      modelMappings: { public: 'gpt-private' }, providerModels: { openai: ['gpt-private', 'gpt-other'] },
      catalogModels: { openai: { 'gpt-private': { id: 'gpt-private', context_window: 90000 } } } }
    expect(listOpenAIStyleModels(key)).toEqual([expect.objectContaining({ id: 'public', context_window: 90000 })])
    expect(listOpenAIStyleModels({ ...key, groupAllowedModels: [] })).toEqual([])
  })
  it('uses the routed provider’s capabilities when native and aggregator catalogs overlap', () => {
    const key = { allowedProviders: ['sub2api', 'openai'], allowedModels: ['gpt-shared'],
      catalogModels: { sub2api: { 'gpt-shared': { id: 'gpt-shared', context_window: 200000 } },
        openai: { 'gpt-shared': { id: 'gpt-shared', context_window: 100000 } } } }
    expect(listOpenAIStyleModels(key)[0]?.context_window).toBe(100000)
    expect(listOpenAIStyleModels(key, 'sub2api')[0]?.context_window).toBe(200000)
  })
})
