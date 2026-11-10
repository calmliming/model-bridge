/**
 * Helpers for building CC Switch (https://ccswitch.io) deep links.
 *
 * CC Switch exposes a `ccswitch://v1/import` deep link that one-click imports a
 * provider into Claude Code / Codex / Gemini CLI / Grok Build. We turn a model-bridge API Key
 * into such a link so users can hand it to CC Switch without editing config files.
 *
 * https://github.com/farion1231/cc-switch/blob/main/docs/guides/deeplink-site-integration-guide-en.md
 */

export type CcSwitchApp = 'claude' | 'codex' | 'gemini' | 'grokbuild'

const API_FORMAT: Record<CcSwitchApp, string> = {
  claude: 'anthropic',
  codex: 'openai_responses',
  gemini: 'gemini_native',
  grokbuild: 'openai_responses',
}

export interface CcSwitchRuntimeConfig {
  ccSwitchApiBaseUrl?: string | null
  openaiImageGenerationEnabled?: boolean
}

// Pinned Codex default from the repository model catalog, shared by native
// OpenAI and Sub2API imports.
export const OPENAI_CC_SWITCH_CODEX_MODEL = 'gpt-6.1-sol'
export const KIMI_CC_SWITCH_MODEL = 'kimi-k3.1-pro'
const GEMINI_CC_SWITCH_MODEL = 'gemini-3.8-flash'
const CLAUDE_FABLE_MODEL = 'claude-fable-5-2'
const CLAUDE_MODEL_SLOTS = {
  opusModel: 'claude-opus-5-5',
  sonnetModel: 'claude-sonnet-5-5',
  haikuModel: 'claude-haiku-5-5',
}

export interface CcSwitchTarget {
  /** Stable id, also matches the snippet tab names in the views. */
  id: string
  /** Target CC Switch application. */
  app: CcSwitchApp
  /** Human label shown on the import button. */
  label: string
  /** Upstream model vendor (模型厂家), used to build the CC Switch provider name. */
  vendor: string
  /** Optional model overrides (DeepSeek presets map onto Claude/Codex model slots). */
  models?: {
    model?: string
    sonnetModel?: string
    haikuModel?: string
    opusModel?: string
    fableModel?: string
  }
  /** Which key provider this target maps to, for filtering by a key's allowedProviders. */
  provider: 'claude' | 'openai' | 'gemini' | 'antigravity' | 'deepseek' | 'xiaomi' | 'zhipu' | 'qwen' | 'kimi' | 'grok' | 'sub2api'
}

/** All supported import targets, in display order. */
export const CC_SWITCH_TARGETS: CcSwitchTarget[] = [
  {
    id: 'claude',
    app: 'claude',
    label: 'Claude Code',
    vendor: 'Claude',
    provider: 'claude',
    models: { ...CLAUDE_MODEL_SLOTS, model: CLAUDE_MODEL_SLOTS.opusModel, fableModel: CLAUDE_FABLE_MODEL },
  },
  {
    id: 'claude-deepseek',
    app: 'claude',
    label: 'Claude Code · DeepSeek',
    vendor: 'DeepSeek',
    models: {
      model: 'deepseek-flash',
      sonnetModel: 'deepseek-flash',
      haikuModel: 'deepseek-flash',
      opusModel: 'deepseek-v4-pro',
    },
    provider: 'deepseek',
  },
  {
    id: 'codex',
    app: 'codex',
    label: 'Codex CLI',
    vendor: 'OpenAI',
    models: { model: OPENAI_CC_SWITCH_CODEX_MODEL },
    provider: 'openai',
  },
  {
    id: 'codex-deepseek',
    app: 'codex',
    label: 'Codex CLI · DeepSeek',
    vendor: 'DeepSeek',
    models: { model: 'deepseek-flash' },
    provider: 'deepseek',
  },
  {
    id: 'claude-xiaomi',
    app: 'claude',
    label: 'Claude Code · MiMo',
    vendor: 'Xiaomi',
    models: {
      model: 'mimo-v2.6-pro',
      sonnetModel: 'mimo-v2.6-pro',
      haikuModel: 'mimo-v2.6-flash',
      opusModel: 'mimo-v2.6-pro',
    },
    provider: 'xiaomi',
  },
  {
    id: 'codex-xiaomi',
    app: 'codex',
    label: 'Codex CLI · MiMo',
    vendor: 'Xiaomi',
    models: { model: 'mimo-v2.6-pro' },
    provider: 'xiaomi',
  },
  {
    id: 'claude-zhipu',
    app: 'claude',
    label: 'Claude Code · GLM',
    vendor: 'Zhipu',
    models: {
      model: 'glm-5.3',
      sonnetModel: 'glm-5.3',
      haikuModel: 'glm-5.3-flash',
      opusModel: 'glm-5.3',
    },
    provider: 'zhipu',
  },
  {
    id: 'codex-zhipu',
    app: 'codex',
    label: 'Codex CLI · GLM',
    vendor: 'Zhipu',
    models: { model: 'glm-5.3' },
    provider: 'zhipu',
  },
  {
    id: 'claude-qwen',
    app: 'claude',
    label: 'Claude Code · Qwen',
    vendor: 'Qwen',
    models: {
      model: 'qwen3.8-max',
      sonnetModel: 'qwen3.7-plus',
      haikuModel: 'qwen3.8-flash',
      opusModel: 'qwen3.8-max',
    },
    provider: 'qwen',
  },
  {
    id: 'codex-qwen',
    app: 'codex',
    label: 'Codex CLI · Qwen',
    vendor: 'Qwen',
    models: { model: 'qwen3.8-max' },
    provider: 'qwen',
  },
  {
    id: 'claude-kimi',
    app: 'claude',
    label: 'Claude Code · Kimi',
    vendor: 'Kimi',
    models: {
      model: KIMI_CC_SWITCH_MODEL,
      sonnetModel: 'kimi-k3',
      haikuModel: 'kimi-k2.7-code',
      opusModel: KIMI_CC_SWITCH_MODEL,
    },
    provider: 'kimi',
  },
  {
    id: 'codex-kimi',
    app: 'codex',
    label: 'Codex CLI · Kimi',
    vendor: 'Kimi',
    models: { model: KIMI_CC_SWITCH_MODEL },
    provider: 'kimi',
  },
  {
    id: 'gemini',
    app: 'gemini',
    label: 'Gemini CLI',
    vendor: 'Gemini',
    models: { model: GEMINI_CC_SWITCH_MODEL },
    provider: 'gemini',
  },
  {
    id: 'claude-antigravity',
    app: 'claude',
    label: 'Claude Code · Antigravity',
    vendor: 'Antigravity',
    provider: 'antigravity',
  },
  {
    id: 'gemini-antigravity',
    app: 'gemini',
    label: 'Gemini CLI · Antigravity',
    vendor: 'Antigravity',
    provider: 'antigravity',
  },
  {
    id: 'grokbuild',
    app: 'grokbuild',
    label: 'Grok Build',
    vendor: 'Grok',
    provider: 'grok',
    models: { model: 'grok-4.5' },
  },
  // Sub2API has distinct protocol routes. Its default Claude model is kept on
  // the family supported by the current Sub2API release.
  {
    id: 'claude-sub2api',
    app: 'claude',
    label: 'Claude Code · Sub2API',
    vendor: 'Sub2API',
    models: { ...CLAUDE_MODEL_SLOTS, model: CLAUDE_MODEL_SLOTS.opusModel },
    provider: 'sub2api',
  },
  {
    id: 'codex-sub2api',
    app: 'codex',
    label: 'Codex CLI · Sub2API',
    vendor: 'Sub2API',
    models: { model: OPENAI_CC_SWITCH_CODEX_MODEL },
    provider: 'sub2api',
  },
  {
    id: 'gemini-sub2api',
    app: 'gemini',
    label: 'Gemini CLI · Sub2API',
    vendor: 'Sub2API',
    models: { model: GEMINI_CC_SWITCH_MODEL },
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
 * A bound group can contain several providers. Intersect its available
 * providers with the key's permissions before deciding whether to open a picker.
 */
export function targetsForProviders(
  allowed?: readonly string[] | null,
  groupProviders?: readonly string[] | null,
): CcSwitchTarget[] {
  return CC_SWITCH_TARGETS.filter(({ provider }) =>
    (!allowed || allowed.includes(provider)) && (!groupProviders || groupProviders.includes(provider)),
  )
}

function buildCodexImportConfig(target: CcSwitchTarget, endpoint: string, openaiImageGenerationEnabled: boolean): string {
  const model = target.models?.model
  const lines = [
    'model_provider = "modelbridge"',
    ...(model ? [`model = ${JSON.stringify(model)}`] : []),
    ...(model === KIMI_CC_SWITCH_MODEL ? ['model_context_window = 1048576', 'model_reasoning_effort = "high"'] : []),
    ...(target.provider === 'openai' || target.provider === 'sub2api' ? ['web_search = "live"'] : []),
    '',
    '[model_providers.modelbridge]',
    `name = ${JSON.stringify(ccSwitchProviderName(target))}`,
    `base_url = ${JSON.stringify(endpoint)}`,
    'wire_api = "responses"',
    'requires_openai_auth = false',
    'supports_websockets = false',
    // Codex uses this marker to register its local image extension. Model
    // Bridge still checks the API key and image policy on the server.
    ...(target.provider === 'openai' && openaiImageGenerationEnabled
      ? ['http_headers = { "x-openai-actor-authorization" = "local-image-extension" }'] : []),
  ]
  return JSON.stringify({ config: lines.join('\n') })
}

/**
 * CC Switch usage-query script. CC Switch runs this against the provider to show
 * "剩余 X USD" on the card — it GETs model-bridge's /api/usage with the provider
 * API key and maps `balance` → remaining. See docs 2.5 用量查询.
 */
const CC_SWITCH_USAGE_SCRIPT =
  '({request:{url:"{{baseUrl}}/api/usage",method:"GET",headers:{"Authorization":"Bearer {{apiKey}}","User-Agent":"cc-switch/1.0"}},' +
  'extractor:function(r){var result={isValid:r.is_active===true,unit:r.currency||"USD"};' +
  'if(typeof r.balance==="number")result.remaining=r.balance;' +
  'if(typeof r.limit==="number"){result.used=r.used;result.total=r.limit;}return result;}})'

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
  opts: CcSwitchRuntimeConfig & { origin: string; apiKey: string; name: string },
): string {
  const origin = opts.origin.replace(/\/+$/, '')
  const baseUrl = opts.ccSwitchApiBaseUrl?.replace(/\/+$/, '') || origin
  const endpoint = `${baseUrl}/api/${target.provider}${API_FORMAT[target.app] === 'openai_responses' ? '/v1' : ''}`
  const claudeDefaults = target.app === 'claude' && (target.provider === 'claude' || target.provider === 'sub2api')
  const entries: [string, string][] = [
    ['resource', 'provider'],
    ['app', target.app],
    ['apiFormat', API_FORMAT[target.app]],
    ['name', opts.name],
    ['homepage', origin],
    ['endpoint', endpoint],
    ['apiKey', opts.apiKey],
    ['configFormat', 'json'],
  ]
  const models = target.models
  if (models) {
    if (models.model && !claudeDefaults) entries.push(['model', models.model])
    if (models.sonnetModel) entries.push(['sonnetModel', models.sonnetModel])
    if (models.haikuModel) entries.push(['haikuModel', models.haikuModel])
    if (models.opusModel) entries.push(['opusModel', models.opusModel])
  }
  if (claudeDefaults) {
    // Set the default for new sessions without overriding a model the user
    // explicitly selects in Claude Code.
    const env = {
      ...(models?.model ? { ANTHROPIC_DEFAULT_MODEL: models.model } : {}),
      ...(models?.fableModel ? { ANTHROPIC_DEFAULT_FABLE_MODEL: models.fableModel } : {}),
    }
    entries.push(['config', toBase64(JSON.stringify({ env }))])
  } else if (target.app === 'codex') {
    entries.push(['config', toBase64(buildCodexImportConfig(target, endpoint, opts.openaiImageGenerationEnabled === true))])
  }
  // Balance display: enable CC Switch's usage query against /api/usage. Pass the
  // key explicitly as usageApiKey so {{apiKey}} resolves even on CC Switch builds
  // that don't auto-fill it from the provider key.
  entries.push(['usageEnabled', 'true'])
  entries.push(['usageAutoInterval', String(CC_SWITCH_USAGE_INTERVAL)])
  entries.push(['usageApiKey', opts.apiKey])
  entries.push(['usageBaseUrl', baseUrl])
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
