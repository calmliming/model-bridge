import { describe, expect, it } from 'vitest'
import { projectCodexManifest } from './codexCatalog'
import { mapRequestedModel } from '../../keys/modelMapping'
import { isRetiredOpenAISubscriptionModel } from './models'

describe('Codex public alias projection', () => {
  const manifest = { etag: 'upstream', models: [
    { slug: 'gpt-6.1-sol', context_window: 500000, service_tiers: ['fast'], unknown: true },
    { slug: 'gpt-5.5', context_window: 256000 },
  ] }
  const supported = (_name: string, target: string) => !isRetiredOpenAISubscriptionModel(target)

  it('projects target capabilities onto aliases before checking public permissions', () => {
    const result = projectCodexManifest(manifest, { 'my-codex': 'gpt-6.1-sol' }, name => name === 'my-codex')
    expect(result.models).toEqual([{ ...manifest.models[0], slug: 'my-codex', display_name: 'my-codex' }])
    expect(result.etag).not.toBe(manifest.etag)
    expect(manifest.models).toHaveLength(2)
  })

  it('maps each public name exactly once, including names that are themselves alias keys', () => {
    const mappings = { alias: 'gpt-6.1-sol', 'gpt-6.1-sol': 'gpt-5.5', 'gpt-5.5': 'gpt-6.1-sol' }
    const result = projectCodexManifest(manifest, mappings, supported)
    expect(result.models).toEqual([
      { ...manifest.models[0], slug: 'gpt-5.5', display_name: 'gpt-5.5' },
      { ...manifest.models[0], slug: 'alias', display_name: 'alias' },
    ])
    for (const item of result.models as Array<{ slug: string }>) expect(isRetiredOpenAISubscriptionModel(mapRequestedModel(item.slug, mappings))).toBe(false)
  })

  it('honors wildcard targets without inventing infinite public aliases', () => {
    const result = projectCodexManifest(manifest, { 'gpt-*': 'gpt-6.1-sol', custom: 'missing-model' }, supported)
    expect(result.models).toHaveLength(2)
    expect((result.models as Array<{ slug: string }>).some(entry => entry.slug.includes('*') || entry.slug === 'custom')).toBe(false)
  })

  it('preserves unmodified capabilities and makes projected etags depend on the client catalog', () => {
    expect(projectCodexManifest(manifest, null, () => true)).toEqual(manifest)
    const result = projectCodexManifest(manifest, { a: 'gpt-6.1-sol' }, supported)
    expect(projectCodexManifest(manifest, { a: 'gpt-6.1-sol' }, supported).etag).toBe(result.etag)
    expect(projectCodexManifest(manifest, { b: 'gpt-6.1-sol' }, supported).etag).not.toBe(result.etag)
  })
})
