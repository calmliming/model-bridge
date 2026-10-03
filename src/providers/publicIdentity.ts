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

/** Preserve useful parameter/error details without disclosing the upstream. */
export function publicMediaError(message: string): string {
  return redactUpstreamError(message).replace(/grsai/gi, '生成服务')
}

export function publicGroupName(name: string): string {
  return name.replace(/grsai/gi, '').trim() || '图片 / 视频'
}
