import { antigravityThinking } from './thinking'
import { ProviderRequestError } from '../requestError'

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** Read before Gemini sanitization removes numeric budgets on newer models. */
export function antigravityThinkingLevel(body: Record<string, unknown>, model = ''): string {
  return antigravityThinking(body, model).level
}

/** Resolve only to variants observed for this account, honoring explicit mappings. */
export function resolveAntigravityModel(model: string, models: unknown, level = 'high', preserveModel = false, strict = false): string {
  if (preserveModel || !model.startsWith('gemini-') || /-(low|medium|high|tiered)$/.test(model) || !Array.isArray(models)) return model
  const ids = new Set(models.map(item => object(item)?.id).filter((id): id is string => typeof id === 'string'))
  if (ids.has(model)) return model
  if (strict) {
    if (ids.has(`${model}-${level}`)) return `${model}-${level}`
    if (ids.has(`${model}-tiered`)) return `${model}-tiered`
    throw new ProviderRequestError('unsupported_reasoning_effort', `The account catalog has no ${level} thinking variant for ${model}`)
  }
  for (const suffix of new Set([level, 'high', 'medium', 'low', 'tiered'])) {
    if (ids.has(`${model}-${suffix}`)) return `${model}-${suffix}`
  }
  return model
}
