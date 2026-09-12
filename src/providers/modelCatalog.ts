export interface CatalogModel {
  id: string
  display_name?: string
  context_window?: number
  max_context_window?: number
  input_modalities?: string[]
  supported_reasoning_levels?: Array<{ effort: string; description: string }>
}
export interface CatalogSnapshot { version: 1; sourceKey: string; syncedAt: number; models: CatalogModel[] }
const MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/\[\]-]{0,199}$/
const EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** Keep only display/capability fields, never arbitrary upstream metadata. */
export function parseModelCatalog(payload: unknown): CatalogModel[] {
  const root = object(payload)
  const list = root?.models ?? root?.data
  if (!Array.isArray(list) || list.length > 2000) throw new Error('模型目录格式无效或条目过多')
  const models = new Map<string, CatalogModel>()
  for (const item of list) {
    const row = object(item)
    if (!row || row.supported_in_api === false || row.visibility === 'hide') continue
    const id = typeof row.slug === 'string' ? row.slug : row.id
    if (typeof id !== 'string' || !MODEL_ID.test(id)) continue
    const model: CatalogModel = { id }
    if (typeof row.display_name === 'string') model.display_name = row.display_name.slice(0, 200)
    for (const field of ['context_window', 'max_context_window'] as const) {
      const value = row[field]
      if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 100_000_000) model[field] = value
    }
    if (Array.isArray(row.input_modalities)) {
      model.input_modalities = [...new Set(row.input_modalities.filter((m): m is string => typeof m === 'string' && ['text', 'image', 'audio', 'video'].includes(m)))]
    }
    if (Array.isArray(row.supported_reasoning_levels)) {
      const levels = new Map<string, { effort: string; description: string }>()
      for (const raw of row.supported_reasoning_levels) {
        const level = object(raw)
        if (typeof level?.effort === 'string' && EFFORTS.has(level.effort)) {
          levels.set(level.effort, { effort: level.effort, description: typeof level.description === 'string' ? level.description.slice(0, 200) : level.effort })
        }
      }
      model.supported_reasoning_levels = [...levels.values()]
    }
    if (!models.has(id)) models.set(id, model)
  }
  if (list.length && !models.size && list.some(raw => {
    const row = object(raw)
    return !row || (row.supported_in_api !== false && row.visibility !== 'hide')
  })) throw new Error('模型目录没有可识别的条目')
  return [...models.values()]
}

export function readCatalogSnapshot(metadata: unknown, sourceKey: string): CatalogSnapshot | null {
  const value = object(object(metadata)?.modelCatalog)
  if (value?.version !== 1 || value.sourceKey !== sourceKey || typeof value.syncedAt !== 'number'
    || !Number.isSafeInteger(value.syncedAt) || value.syncedAt <= 0) return null
  try { return { version: 1, sourceKey, syncedAt: value.syncedAt, models: parseModelCatalog({ models: value.models }) } }
  catch { return null }
}

/** Advertise only capabilities shared by every observed account for a model. */
export function mergeCatalogModels(left: CatalogModel, right: CatalogModel): CatalogModel {
  const result: CatalogModel = { id: left.id, display_name: left.display_name ?? right.display_name }
  for (const field of ['context_window', 'max_context_window'] as const) {
    if (left[field] != null && right[field] != null) result[field] = Math.min(left[field], right[field])
  }
  if (left.input_modalities && right.input_modalities) result.input_modalities = left.input_modalities.filter(m => right.input_modalities!.includes(m))
  if (left.supported_reasoning_levels && right.supported_reasoning_levels) {
    result.supported_reasoning_levels = left.supported_reasoning_levels.filter(l => right.supported_reasoning_levels!.some(r => r.effort === l.effort))
  }
  return result
}
