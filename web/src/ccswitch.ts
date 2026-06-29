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

export const OPENAI_CC_SWITCH_CODEX_MODEL = 'gpt-5.5'

export interface CcSwitchTarget {
  /** Stable id, also matches the snippet tab names in the views. */
  id: string
  /** Target CC Switch application. */
  app: CcSwitchApp
  /** Human label shown on the import button. */
  label: string
  /** Upstream model vendor (模型厂家), used to build the CC Switch provider name. */
  vendor: string
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
  provider: 'claude' | 'openai' | 'gemini' | 'deepseek' | 'xiaomi' | 'zhipu'
}

/** All supported import targets, in display order. */
export const CC_SWITCH_TARGETS: CcSwitchTarget[] = [
  {
    id: 'claude',
    app: 'claude',
    label: 'Claude Code',
    vendor: 'Claude',
    endpoint: (origin) => origin,
    provider: 'claude',
  },
  {
    id: 'claude-deepseek',
    app: 'claude',
    label: 'Claude Code · DeepSeek',
    vendor: 'DeepSeek',
    endpoint: (origin) => origin,
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
    vendor: 'OpenAI',
    endpoint: (origin) => origin,
    models: { model: OPENAI_CC_SWITCH_CODEX_MODEL },
    provider: 'openai',
  },
  {
    id: 'codex-deepseek',
    app: 'codex',
    label: 'Codex CLI · DeepSeek',
    vendor: 'DeepSeek',
    endpoint: (origin) => origin,
    models: { model: 'deepseek-v4-pro' },
    provider: 'deepseek',
  },
  {
    id: 'claude-xiaomi',
    app: 'claude',
    label: 'Claude Code · MiMo',
    vendor: 'Xiaomi',
    endpoint: (origin) => origin,
    models: {
      model: 'mimo-v2.5-pro',
      sonnetModel: 'mimo-v2.5-pro',
      haikuModel: 'mimo-v2.5',
      opusModel: 'mimo-v2.5-pro',
    },
    provider: 'xiaomi',
  },
  {
    id: 'codex-xiaomi',
    app: 'codex',
    label: 'Codex CLI · MiMo',
    vendor: 'Xiaomi',
    endpoint: (origin) => origin,
    models: { model: 'mimo-v2.5-pro' },
    provider: 'xiaomi',
  },
  {
    id: 'claude-zhipu',
    app: 'claude',
    label: 'Claude Code · GLM',
    vendor: 'Zhipu',
    endpoint: (origin) => origin,
    models: {
      model: 'glm-5.2',
      sonnetModel: 'glm-5.2',
      haikuModel: 'glm-5.1',
      opusModel: 'glm-5.2',
    },
    provider: 'zhipu',
  },
  {
    id: 'codex-zhipu',
    app: 'codex',
    label: 'Codex CLI · GLM',
    vendor: 'Zhipu',
    endpoint: (origin) => origin,
    models: { model: 'glm-5.2' },
    provider: 'zhipu',
  },
  {
    id: 'gemini',
    app: 'gemini',
    label: 'Gemini CLI',
    vendor: 'Gemini',
    endpoint: (origin) => origin,
    provider: 'gemini',
  },
]

/** Brand prefix for provider names imported into CC Switch. */
export const CC_SWITCH_BRAND = 'ModelBridge'

/**
 * Builds the provider name shown inside CC Switch, e.g. "ModelBridge-Claude".
 * Brand prefix + upstream vendor (模型厂家); short and deterministic, so the
 * same upstream always lands on the same CC Switch provider entry.
 */
export function ccSwitchProviderName(target: CcSwitchTarget): string {
  return `${CC_SWITCH_BRAND}-${target.vendor}`
}

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
/**
 * CC Switch usage-query script. CC Switch runs this against the provider to show
 * "剩余 X USD" on the card — it GETs model-bridge's /api/usage with the provider
 * API key and maps `balance` → remaining. See docs 2.5 用量查询.
 */
const CC_SWITCH_USAGE_SCRIPT =
  '({request:{url:"{{baseUrl}}/api/usage",method:"GET",headers:{"Authorization":"Bearer {{apiKey}}","User-Agent":"cc-switch/1.0"}},' +
  'extractor:function(r){return{isValid:r.balance!=null,remaining:r.balance,used:r.used,total:r.limit,unit:r.currency||"USD"};}})'

/** Auto-refresh interval (minutes) for the balance query. */
const CC_SWITCH_USAGE_INTERVAL = 30

/**
 * Base64-encodes a UTF-8 string. CC Switch Base64-decodes the `usageScript`
 * parameter (after URL-decoding the query), so the raw JS must be Base64'd
 * first — otherwise it rejects the link with "usage_script ... Base64 解码失败:
 * Invalid symbol 40" (the script starts with '('). encodeURIComponent at the
 * call site then percent-escapes '+' '/' '=' so the Base64 survives the URL.
 */
function toBase64(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

/*
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
  // Balance display: enable CC Switch's usage query against /api/usage. Pass the
  // key explicitly as usageApiKey so {{apiKey}} resolves even on CC Switch builds
  // that don't auto-fill it from the provider key.
  parts.push('usageEnabled=true')
  parts.push(`usageAutoInterval=${CC_SWITCH_USAGE_INTERVAL}`)
  parts.push(`usageApiKey=${encodeURIComponent(opts.apiKey)}`)
  parts.push(`usageScript=${encodeURIComponent(toBase64(CC_SWITCH_USAGE_SCRIPT))}`)
  return `ccswitch://v1/import?${parts.join('&')}`
}

/** Launches the deep link, handing the provider config off to CC Switch. */
export function launchCcSwitch(url: string): void {
  if (typeof window === 'undefined') return
  window.location.href = url
}
