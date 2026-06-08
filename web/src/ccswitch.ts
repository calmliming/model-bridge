/**
 * Helpers for building CC Switch (https://ccswitch.io) deep links.
 *
 * CC Switch exposes a `ccswitch://v1/import` deep link that one-click imports a
 * provider into Claude Code / Codex / Gemini CLI. We turn a model-bridge API Key
 * into such a link so users can hand it to CC Switch without editing config files.
 *
 * Format (provider import):
 *   ccswitch://v1/import?resource=provider&app=<app>&name=<name>&endpoint=<url>&apiKey=<key>[&model=...&sonnetModel=...&haikuModel=...&opusModel=...]
 *
 * `app` accepts claude / codex / gemini (CC Switch also supports opencode / openclaw).
 */

export type CcSwitchApp = 'claude' | 'codex' | 'gemini'

export interface CcSwitchTarget {
  /** Stable id, also matches the snippet tab names in the views. */
  id: string
  /** Target CC Switch application. */
  app: CcSwitchApp
  /** Human label shown on the import button. */
  label: string
  /** Builds the provider endpoint from the deployment origin (e.g. https://bridge.example.com). */
  endpoint: (origin: string) => string
  /** Optional model overrides (DeepSeek presets map onto Claude/Codex model slots). */
  models?: {
    model?: string
    sonnetModel?: string
    haikuModel?: string
    opusModel?: string
  }
  /** Which key provider this target maps to, for filtering by a key's allowedProviders. */
  provider: 'claude' | 'openai' | 'gemini' | 'deepseek'
}

/** All supported import targets, in display order. */
export const CC_SWITCH_TARGETS: CcSwitchTarget[] = [
  {
    id: 'claude',
    app: 'claude',
    label: 'Claude Code',
    endpoint: (origin) => origin,
    provider: 'claude',
  },
  {
    id: 'claude-deepseek',
    app: 'claude',
    label: 'Claude Code · DeepSeek',
    endpoint: (origin) => `${origin}/api/deepseek`,
    models: {
      model: 'deepseek-v4-pro',
      sonnetModel: 'deepseek-v4-pro',
      haikuModel: 'deepseek-v4-flash',
      opusModel: 'deepseek-v4-pro',
    },
    provider: 'deepseek',
  },
  {
    id: 'codex',
    app: 'codex',
    label: 'Codex CLI',
    endpoint: (origin) => `${origin}/v1`,
    provider: 'openai',
  },
  {
    id: 'codex-deepseek',
    app: 'codex',
    label: 'Codex CLI · DeepSeek',
    endpoint: (origin) => `${origin}/api/deepseek/v1`,
    models: { model: 'deepseek-v4-pro' },
    provider: 'deepseek',
  },
  {
    id: 'gemini',
    app: 'gemini',
    label: 'Gemini CLI',
    endpoint: (origin) => origin,
    provider: 'gemini',
  },
]

/** Looks up a target by its id. */
export function ccSwitchTarget(id: string): CcSwitchTarget | undefined {
  return CC_SWITCH_TARGETS.find((t) => t.id === id)
}

/**
 * Returns the import targets relevant to a key, honoring its allowedProviders.
 * A null/empty list means "all providers", so every target applies.
 */
export function targetsForProviders(allowed: string[] | null | undefined): CcSwitchTarget[] {
  if (!allowed || allowed.length === 0) return CC_SWITCH_TARGETS
  const set = new Set(allowed)
  return CC_SWITCH_TARGETS.filter((t) => set.has(t.provider))
}

/**
 * Builds a `ccswitch://v1/import` provider deep link.
 * Query values are encoded with encodeURIComponent (spaces as %20) to match the
 * format CC Switch documents and parses.
 */
export function buildCcSwitchUrl(
  target: CcSwitchTarget,
  opts: { origin: string; apiKey: string; name: string },
): string {
  const parts = [
    'resource=provider',
    `app=${encodeURIComponent(target.app)}`,
    `name=${encodeURIComponent(opts.name)}`,
    `endpoint=${encodeURIComponent(target.endpoint(opts.origin))}`,
    `apiKey=${encodeURIComponent(opts.apiKey)}`,
  ]
  const models = target.models
  if (models) {
    if (models.model) parts.push(`model=${encodeURIComponent(models.model)}`)
    if (models.sonnetModel) parts.push(`sonnetModel=${encodeURIComponent(models.sonnetModel)}`)
    if (models.haikuModel) parts.push(`haikuModel=${encodeURIComponent(models.haikuModel)}`)
    if (models.opusModel) parts.push(`opusModel=${encodeURIComponent(models.opusModel)}`)
  }
  return `ccswitch://v1/import?${parts.join('&')}`
}

/** Launches the deep link, handing the provider config off to CC Switch. */
export function launchCcSwitch(url: string): void {
  if (typeof window === 'undefined') return
  window.location.href = url
}
