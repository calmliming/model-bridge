import { redactUpstreamError } from '../http/upstreamDiagnostics'

/** Customer-facing capability scope; concrete upstream IDs stay server-side. */
export function publicKeyProviders(providers: readonly string[] | null | undefined): string[] | null {
  return providers == null ? null : [...new Set(providers.map(provider => provider === 'grsai' ? 'media' : provider))]
}

export function internalKeyProviders(providers: readonly string[] | null | undefined): string[] | null | undefined {
  return providers == null ? providers : [...new Set(providers.map(provider => provider === 'media' ? 'grsai' : provider))]
}

export function publicModelProvider(provider: string, model = ''): string {
  if (provider !== 'grsai') return provider
  return 'modelbridge'
}

/**
 * Chinese display name for a provider, used in customer-facing messages that
 * name the service ("生成服务账号正在冷却中…") instead of leaking the upstream
 * id. Unknown providers keep their id so the message is still actionable.
 */
const PROVIDER_LABELS: Record<string, string> = {
  grsai: '生成服务',
  claude: 'Claude',
  openai: 'OpenAI',
  gemini: 'Gemini',
  antigravity: 'Antigravity',
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  kimi: 'Kimi',
  zhipu: '智谱',
  xiaomi: '小米',
  grok: 'Grok',
  sub2api: 'Sub2API',
}

export function publicProviderLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider
}

/** Preserve useful parameter/error details without disclosing the upstream. */
export function publicMediaError(message: string): string {
  return redactUpstreamError(message).replace(/grsai/gi, '生成服务')
}

export function publicGroupName(name: string): string {
  return name.replace(/grsai/gi, '').trim() || '图片 / 视频'
}
