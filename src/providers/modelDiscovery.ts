import { isAllowedModel } from '../keys/modelAllowlist'
import type { ProviderId } from './types'

export interface ModelDiscoveryKey {
  allowedProviders: readonly string[] | null
  allowedModels: string[] | null
  modelMappings?: Record<string, string> | null
}

export interface ModelItem {
  id: string
  object: 'model'
  created: number
  owned_by: string
  type: 'model'
  display_name: string
}

export interface GeminiModelItem {
  name: string
  version: string
  displayName: string
  supportedGenerationMethods: string[]
}

const CREATED_AT = 1_704_067_200

// Curated per-provider model lists surfaced by GET /v1/models. This is a
// discovery/display list only — actual relaying passes body.model through
// untouched, so a model missing here can still be called directly (unless a
// key pins an exact allowedModels allow-list). Keep the current flagship of
// each tier here; pricing.ts resolves any other version via substring tiers.
const DEFAULT_MODELS: Record<ProviderId, string[]> = {
  claude: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-fable-5'],
  openai: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex'],
  gemini: ['gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'],
  deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'],
  xiaomi: ['mimo-v2.5-pro', 'mimo-v2.5'],
}

const PROVIDERS: ProviderId[] = ['claude', 'openai', 'gemini', 'deepseek', 'xiaomi']

function inferProvider(model: string): ProviderId | null {
  const lower = model.toLowerCase()
  if (lower.startsWith('claude-')) return 'claude'
  if (lower.startsWith('gpt-') || lower.startsWith('o1') || lower.startsWith('o3')) return 'openai'
  if (lower.startsWith('gemini-')) return 'gemini'
  if (lower.startsWith('deepseek-')) return 'deepseek'
  if (lower.startsWith('mimo-')) return 'xiaomi'
  return null
}

function displayName(model: string): string {
  return model
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function providerScope(key: ModelDiscoveryKey, requested?: ProviderId): ProviderId[] {
  const allowed = (key.allowedProviders ?? PROVIDERS).filter((provider): provider is ProviderId =>
    PROVIDERS.includes(provider as ProviderId),
  )
  if (!requested) return allowed
  return allowed.includes(requested) ? [requested] : []
}

function exactAllowedModelEntries(key: ModelDiscoveryKey): string[] {
  return (key.allowedModels ?? [])
    .map((model) => model.trim())
    .filter((model) => model && !model.includes('*'))
}

function exactMappingSources(key: ModelDiscoveryKey): Array<{ from: string; to: string }> {
  return Object.entries(key.modelMappings ?? {})
    .map(([from, to]) => ({ from: from.trim(), to: to.trim() }))
    .filter((entry) => entry.from && entry.to && !entry.from.includes('*'))
}

function includeCustomAllowedModels(
  ids: string[],
  key: ModelDiscoveryKey,
  providers: ProviderId[],
  requested?: ProviderId,
): void {
  for (const model of exactAllowedModelEntries(key)) {
    if (ids.includes(model)) continue
    const inferred = inferProvider(model)
    if (inferred) {
      if (providers.includes(inferred) && (!requested || requested === inferred)) ids.push(model)
      continue
    }
    if (requested || providers.length === 1) ids.push(model)
  }
}

function includeMappedModels(
  ids: string[],
  key: ModelDiscoveryKey,
  providers: ProviderId[],
  requested?: ProviderId,
): void {
  for (const { from, to } of exactMappingSources(key)) {
    if (ids.includes(from)) continue
    if (!isAllowedModel(from, key.allowedModels) && !isAllowedModel(to, key.allowedModels)) continue
    const sourceProvider = inferProvider(from)
    const targetProvider = inferProvider(to)
    const provider = sourceProvider ?? targetProvider
    if (provider) {
      if (providers.includes(provider) && (!requested || requested === provider)) ids.push(from)
      continue
    }
    if (requested || providers.length === 1) ids.push(from)
  }
}

export function isProviderAllowed(provider: ProviderId, key: ModelDiscoveryKey): boolean {
  return providerScope(key, provider).length > 0
}

export function listModelIdsForKey(key: ModelDiscoveryKey, requested?: ProviderId): string[] {
  const providers = providerScope(key, requested)
  const ids: string[] = []
  for (const provider of providers) {
    for (const model of DEFAULT_MODELS[provider]) {
      if (isAllowedModel(model, key.allowedModels)) ids.push(model)
    }
  }
  includeMappedModels(ids, key, providers, requested)
  includeCustomAllowedModels(ids, key, providers, requested)
  return ids
}

export function listOpenAIStyleModels(key: ModelDiscoveryKey, requested?: ProviderId): ModelItem[] {
  return listModelIdsForKey(key, requested).map((id) => ({
    id,
    object: 'model',
    created: CREATED_AT,
    owned_by: inferProvider(id) ?? requested ?? 'model-bridge',
    type: 'model',
    display_name: displayName(id),
  }))
}

export function listGeminiModels(key: ModelDiscoveryKey): GeminiModelItem[] {
  return listModelIdsForKey(key, 'gemini').map((id) => ({
    name: `models/${id}`,
    version: '001',
    displayName: displayName(id),
    supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
  }))
}
