import { ProviderRequestError } from '../requestError'

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export type ThinkingLevel = 'low' | 'medium' | 'high' | 'xhigh'
const budgets: Record<ThinkingLevel, number> = { low: 1024, medium: 8192, high: 16384, xhigh: 32768 }

/** One interpretation feeds variant selection, the forwarded config and usage diagnostics. */
export function antigravityThinking(body: Record<string, unknown>, model = '') {
  const generation = object(body.generationConfig) ?? object(body.generation_config)
  const native = object(generation?.thinkingConfig) ?? object(generation?.thinking_config)
  const thinking = object(body.thinking)
  const effort = object(body.output_config)?.effort ?? body.reasoning_effort ?? object(body.reasoning)?.effort
  const supportsXhigh = /^(?:models\/)?gemini-4-hydrogen(?:$|-)/i.test(model)
  const allowedLevels: ThinkingLevel[] = supportsXhigh ? ['low', 'medium', 'high', 'xhigh'] : ['low', 'medium', 'high']
  const levelHint = supportsXhigh ? 'low, medium, high or xhigh' : 'low, medium or high'
  const nativeLevel = native?.thinkingLevel ?? native?.thinking_level
  if (nativeLevel !== undefined && (typeof nativeLevel !== 'string'
    || !allowedLevels.includes(nativeLevel.toLowerCase().trim() as ThinkingLevel))) {
    throw new ProviderRequestError('unsupported_reasoning_effort', `Use ${levelHint} Gemini thinking level`)
  }
  const suffix = (supportsXhigh ? /-(low|medium|high|xhigh)$/i : /-(low|medium|high)$/i).exec(model)?.[1]?.toLowerCase() as ThinkingLevel | undefined
  const budget = native ? native.thinkingBudget ?? native.thinking_budget : thinking?.budget_tokens
  if (!native && budget !== undefined && (typeof budget !== 'number' || !Number.isFinite(budget) || budget < 0)) {
    throw new ProviderRequestError('invalid_thinking_budget', 'Thinking budget must be a finite non-negative number')
  }
  let level: ThinkingLevel = 'high'
  if (suffix) level = suffix
  else if (typeof nativeLevel === 'string' && allowedLevels.includes(nativeLevel.toLowerCase().trim() as ThinkingLevel)) {
    level = nativeLevel.toLowerCase().trim() as ThinkingLevel
  } else if (thinking?.type === 'disabled') level = 'low'
  else if (effort !== undefined) {
    const normalized = typeof effort === 'string' ? effort.toLowerCase().trim() : ''
    if (['none', 'minimal', 'low'].includes(normalized)) level = 'low'
    else if (normalized === 'medium') level = 'medium'
    else if (normalized === 'high') level = 'high'
    else if (['xhigh', 'max', 'ultra'].includes(normalized)) level = supportsXhigh ? 'xhigh' : 'high'
    else throw new ProviderRequestError('unsupported_reasoning_effort', `Use ${levelHint} Gemini reasoning effort`)
  } else if (typeof budget === 'number' && Number.isFinite(budget) && budget >= 0) {
    level = budget <= 1024 ? 'low' : budget <= 8192 ? 'medium' : 'high'
  } else if (thinking && !model.startsWith('gemini-') && ['enabled', 'adaptive'].includes(String(thinking.type))) level = 'medium'
  const explicit = !!suffix || nativeLevel !== undefined || effort !== undefined || typeof budget === 'number' || thinking?.type === 'disabled'
  const active = native || suffix || effort !== undefined || ['disabled', 'enabled', 'adaptive'].includes(String(thinking?.type))
  if (!active) return { level, explicit, config: undefined }
  const includeThoughts = native?.includeThoughts ?? native?.include_thoughts
    ?? (thinking?.type === 'enabled' || thinking?.type === 'adaptive')
  const config = { ...native, includeThoughts } as Record<string, unknown>
  for (const field of ['thinkingLevel', 'thinking_level', 'thinkingBudget', 'thinking_budget', 'include_thoughts']) delete config[field]
  if (/^gemini-(?:[3-9]|\d{2})/.test(model)) config.thinkingLevel = level
  else config.thinkingBudget = thinking?.type === 'disabled' ? 0
    : typeof budget === 'number' && effort === undefined && !suffix ? Math.min(63999, Math.trunc(budget)) : budgets[level]
  return { level, explicit, config }
}
