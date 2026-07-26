/**
 * Helpers for building CC Switch (https://ccswitch.io) deep links.
 *
 * CC Switch exposes a `ccswitch://v1/import` deep link that one-click imports a
 * provider into Claude Code / Codex / Gemini CLI. We turn a model-bridge API Key
 * into such a link so users can hand it to CC Switch without editing config files.
 *
 * Format (provider import, aligned with sub2api's implementation):
 *   ccswitch://v1/import?resource=provider&app=<app>&name=<name>&homepage=<origin>&endpoint=<url>&apiKey=<key>&configFormat=json[&model=...&sonnetModel=...&haikuModel=...&opusModel=...]
 *
 * `app` accepts claude / codex / gemini (CC Switch also supports opencode / openclaw).
 */

export type CcSwitchApp = 'claude' | 'codex' | 'gemini'

// Default model for Codex CLI: gpt-5.6-sol is the recommended flagship for
// agent coding tasks, offering the best reasoning and coding capabilities.
export const OPENAI_CC_SWITCH_CODEX_MODEL = 'gpt-5.6-sol'

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
  provider: 'claude' | 'openai' | 'gemini' | 'deepseek' | 'xiaomi' | 'zhipu' | 'qwen' | 'kimi' | 'sub2api'
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
    // Claude Code defaults: Opus 5 for complex reasoning, Sonnet 5 for balanced
    // tasks, Haiku 4.5 for lightweight work. Using latest recommended models.
    models: {
      opusModel: 'claude-opus-5',
      sonnetModel: 'claude-sonnet-5',
      haikuModel: 'claude-haiku-4-5',
    },
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
    id: 'claude-qwen',
    app: 'claude',
    label: 'Claude Code · Qwen',
    vendor: 'Qwen',
    endpoint: (origin) => origin,
    models: {
      model: 'qwen3-coder-plus',
      sonnetModel: 'qwen3-coder-plus',
      haikuModel: 'qwen-plus',
      opusModel: 'qwen3-coder-plus',
    },
    provider: 'qwen',
  },
  {
    id: 'codex-qwen',
    app: 'codex',
    label: 'Codex CLI · Qwen',
    vendor: 'Qwen',
    endpoint: (origin) => origin,
    models: { model: 'qwen3-coder-plus' },
    provider: 'qwen',
  },
  {
    id: 'claude-kimi',
    app: 'claude',
    label: 'Claude Code · Kimi',
    vendor: 'Kimi',
    endpoint: (origin) => origin,
    models: {
      model: 'kimi-k3',
      sonnetModel: 'kimi-k3',
      haikuModel: 'kimi-k2.6',
      opusModel: 'kimi-k3',
    },
    provider: 'kimi',
  },
  {
    id: 'codex-kimi',
    app: 'codex',
    label: 'Codex CLI · Kimi',
    vendor: 'Kimi',
    endpoint: (origin) => origin,
    models: { model: 'kimi-k2.7-code' },
    provider: 'kimi',
  },
  {
    id: 'gemini',
    app: 'gemini',
    label: 'Gemini CLI',
    vendor: 'Gemini',
    endpoint: (origin) => origin,
    provider: 'gemini',
  },
  // Sub2API aggregates multiple model families behind one bare-domain endpoint,
  // routed by model name. A sub2api-only key hitting the origin therefore works
  // for Claude Code / Codex / Gemini alike, so expose one target per client.
  {
    id: 'claude-sub2api',
    app: 'claude',
    label: 'Claude Code · Sub2API',
    vendor: 'Sub2API',
    endpoint: (origin) => origin,
    provider: 'sub2api',
  },
  {
    id: 'codex-sub2api',
    app: 'codex',
    label: 'Codex CLI · Sub2API',
    vendor: 'Sub2API',
    endpoint: (origin) => origin,
    models: { model: 'gpt-5.6-sol' },
    provider: 'sub2api',
  },
  {
    id: 'gemini-sub2api',
    app: 'gemini',
    label: 'Gemini CLI · Sub2API',
    vendor: 'Sub2API',
    endpoint: (origin) => origin,
    provider: 'sub2api',
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
  const matched = CC_SWITCH_TARGETS.filter((t) => set.has(t.provider))
  // Safety net: a key restricted to a provider with no dedicated target (e.g. a
  // future upstream not yet mapped here) would otherwise yield an empty picker.
  // Fall back to all targets so the modal is never blank.
  return matched.length > 0 ? matched : CC_SWITCH_TARGETS
}

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
 * Invalid symbol 40" (the script starts with '('). URLSearchParams then
 * percent-escapes '+' '/' '=' so the Base64 survives the URL.
 */
function toBase64(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

/*
 * Query values are encoded with URLSearchParams, matching sub2api's deep link
 * builder (CC Switch parses both %20 and '+' for spaces).
 */
export function buildCcSwitchUrl(
  target: CcSwitchTarget,
  opts: { origin: string; apiKey: string; name: string },
): string {
  const entries: [string, string][] = [
    ['resource', 'provider'],
    ['app', target.app],
    ['name', opts.name],
    ['homepage', opts.origin],
    ['endpoint', target.endpoint(opts.origin)],
    ['apiKey', opts.apiKey],
    ['configFormat', 'json'],
  ]
  const models = target.models
  if (models) {
    if (models.model) entries.push(['model', models.model])
    if (models.sonnetModel) entries.push(['sonnetModel', models.sonnetModel])
    if (models.haikuModel) entries.push(['haikuModel', models.haikuModel])
    if (models.opusModel) entries.push(['opusModel', models.opusModel])
  }
  // Balance display: enable CC Switch's usage query against /api/usage. Pass the
  // key explicitly as usageApiKey so {{apiKey}} resolves even on CC Switch builds
  // that don't auto-fill it from the provider key.
  entries.push(['usageEnabled', 'true'])
  entries.push(['usageAutoInterval', String(CC_SWITCH_USAGE_INTERVAL)])
  entries.push(['usageApiKey', opts.apiKey])
  entries.push(['usageScript', toBase64(CC_SWITCH_USAGE_SCRIPT)])
  return `ccswitch://v1/import?${new URLSearchParams(entries).toString()}`
}

/**
 * Launches the deep link, handing the provider config off to CC Switch.
 * Returns a promise resolving to false when the protocol handler likely failed
 * (page still focused shortly after the attempt — sub2api's detection trick),
 * so callers can tell the user CC Switch isn't installed.
 */
export function launchCcSwitch(url: string): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  try {
    window.open(url, '_self')
  } catch {
    return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    // If the OS handed the link to CC Switch, the browser loses focus; if no
    // handler is registered we typically keep focus. Heuristic, same as sub2api.
    setTimeout(() => resolve(!document.hasFocus()), 100)
  })
}
