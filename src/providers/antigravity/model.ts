function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** Read before Gemini sanitization removes numeric budgets on newer models. */
export function antigravityThinkingLevel(body: Record<string, unknown>): string {
  const generation = object(body.generationConfig) ?? object(body.generation_config)
  const native = object(generation?.thinkingConfig) ?? object(generation?.thinking_config)
  const thinking = object(body.thinking)
  const level = native?.thinkingLevel ?? native?.thinking_level
  if (typeof level === 'string' && ['low', 'medium', 'high'].includes(level.toLowerCase().trim())) return level.toLowerCase().trim()
  if (thinking?.type === 'disabled') return 'low'
  const budget = native ? native.thinkingBudget ?? native.thinking_budget : thinking?.budget_tokens
  if (typeof budget !== 'number' || !Number.isFinite(budget) || budget < 0 || (!native && budget === 0)) return 'high'
  return budget <= 1024 ? 'low' : budget <= 8192 ? 'medium' : 'high'
}

/** Resolve only to variants observed for this account, honoring explicit mappings. */
export function resolveAntigravityModel(model: string, models: unknown, level = 'high', preserveModel = false): string {
  if (preserveModel || !model.startsWith('gemini-') || /-(low|medium|high|tiered)$/.test(model) || !Array.isArray(models)) return model
  const ids = new Set(models.map(item => object(item)?.id).filter((id): id is string => typeof id === 'string'))
  if (ids.has(model)) return model
  for (const suffix of new Set([level, 'high', 'medium', 'low', 'tiered'])) {
    if (ids.has(`${model}-${suffix}`)) return `${model}-${suffix}`
  }
  return model
}
