import { formatTokens } from './utils'

export interface RequestLog {
  id: string; taskId: string | null; createdAt: number; updatedAt: number
  manufacturer: string; model: string | null; requestedModel: string | null
  kind: 'text' | 'image' | 'video'; status: 'running' | 'settling' | 'success' | 'error'
  taskStatus: string | null; progress: number | null; apiKeyName: string | null
  latencyMs: number; cost: number | null; subscriptionPoints: number | null; billTo: string | null
  inputTokens: number; outputTokens: number; cacheTokens: number; imageCount: number
  videoSeconds: number; videoResolution: string | null; requestInput: string | null
  errorCode: string | null; errorMessage: string | null; results: Array<{ url: string }>
  provider?: string; accountName?: string | null; userName?: string | null; upstreamRequestId?: string | null
}

export interface RequestLogsPage {
  page: number; pageSize: number; total: number; logs: RequestLog[]
  manufacturers: Array<{ value: string; label: string }>
}

export function logStatusLabel(log: Pick<RequestLog, 'status' | 'taskStatus'>): string {
  if (log.status === 'running') return log.taskStatus === 'submitting' ? '提交中' : '生成中'
  return { settling: '结算中', success: '成功', error: '失败' }[log.status]
}

export function logUsageLabel(log: Pick<RequestLog, 'kind' | 'videoSeconds' | 'videoResolution' | 'imageCount' | 'inputTokens' | 'outputTokens' | 'cacheTokens' | 'status'>): string {
  if (log.kind === 'video' && log.videoSeconds) return `${log.videoSeconds} 秒${log.videoResolution ? ` · ${log.videoResolution}` : ''}`
  const tokens = log.inputTokens + log.outputTokens + log.cacheTokens
  const parts = [log.imageCount > 0 ? `${log.imageCount} 张` : '', tokens > 0 ? `${formatTokens(tokens)} Tokens` : ''].filter(Boolean)
  return parts.join(' · ') || (log.status === 'running' || log.status === 'settling' ? '等待结果' : '—')
}

export function safeResultUrl(value: string): string | null {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null }
  catch { return null }
}
