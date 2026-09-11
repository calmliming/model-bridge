import type { AccountQuotaSnapshot, AccountQuotaWindow } from '../../accounts/quota'
import { antigravityJson, object } from './client'

export interface AntigravityModel { id: string; displayName: string }

export function parseAntigravityModels(data: unknown, now = Date.now()): { models: AntigravityModel[]; quota: AccountQuotaSnapshot } {
  const entries = object(object(data)?.models)
  if (!entries) throw new Error('Antigravity 未返回有效模型目录')
  const models: AntigravityModel[] = []
  const windows: AccountQuotaWindow[] = []
  for (const [id, raw] of Object.entries(entries).slice(0, 300)) {
    if (!/^(gemini|claude)-[a-z\d._-]+$/i.test(id)) continue
    const model = object(raw)
    models.push({ id, displayName: typeof model?.displayName === 'string' ? model.displayName.slice(0, 200) : id })
    const quota = object(model?.quotaInfo)
    if (typeof quota?.remainingFraction !== 'number' || !Number.isFinite(quota.remainingFraction)) continue
    const usedPercent = Math.round(Math.max(0, Math.min(100, (1 - quota.remainingFraction) * 100)) * 1e6) / 1e6
    const reset = typeof quota.resetTime === 'string' ? Date.parse(quota.resetTime) : NaN
    windows.push({ key: 'model', model: id, label: id, usedPercent, exceeded: usedPercent >= 100, resetAt: Number.isFinite(reset) ? reset : null })
  }
  return { models, quota: { source: 'antigravity', updatedAt: now, windows } }
}

export async function fetchAntigravityModels(token: string, project: string) {
  return parseAntigravityModels(await antigravityJson(token, 'fetchAvailableModels', { project }))
}
