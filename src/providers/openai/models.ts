/** GPT-6.1 Sol in either published (`gpt-6.1-sol`) or dashed spelling, with optional suffixes. */
export function isGpt61SolModel(model: unknown): boolean {
  return typeof model === 'string' && /^gpt-6[.-]1-sol(?:$|-)/i.test(model.trim())
}

/**
 * GPT-5 and every later generation are reasoning-only, and the Responses API
 * rejects temperature/top_p for them. Keyed on the generation number so new
 * families are covered without another edit; gpt-image-*, gpt-4.x and other
 * ids without a numeric generation of 5+ are not reasoning models.
 */
export function isOpenAIReasoningModel(model: unknown): boolean {
  if (typeof model !== 'string') return false
  const generation = /^gpt-(\d+)/i.exec(model.trim())
  return !!generation && Number(generation[1]) >= 5
}

/** Whether a converted Chat request may keep temperature/top_p. */
export function acceptsOpenAISamplingParams(model: unknown, reasoningEffort: unknown): boolean {
  if (!isOpenAIReasoningModel(model)) return true
  // GPT-6 Sol/Luna accept sampling controls when reasoning is turned off.
  return reasoningEffort === 'none' && typeof model === 'string' && (/^gpt-6-(?:sol|luna)(?:$|-)/i.test(model.trim()) || isGpt61TerraModel(model))
}

/** Retirement applies to ChatGPT subscription upstreams, not API-key gateways. */
export function isRetiredOpenAISubscriptionModel(model: string): boolean {
  return /^gpt-5[.-]5(?:$|-)/i.test(model.trim())
}

/** Called after key/group mappings and before acquiring an upstream account. */
export function validateOpenAISubscriptionModel(model: string): string {
  if (isRetiredOpenAISubscriptionModel(model)) {
    throw Object.assign(new Error('GPT-5.5 is no longer available through ChatGPT subscription accounts. Configure an explicit mapping to an available model or use an API-key upstream.'), {
      statusCode: 404, code: 'model_not_found',
    })
  }
  return model
}

/** Terra accepts disabled reasoning; both canonical spellings share pricing. */
export function isGpt61TerraModel(model: unknown): boolean {
  return typeof model === 'string' && /^gpt-6[.-]1-terra(?:$|-)/i.test(model.trim())
}

export function normalizeTerraRequest(body: Record<string, unknown>): Record<string, unknown> {
  if (!isGpt61TerraModel(body.model)) return body
  const out = { ...body }
  const alias = /^gpt-6[.-]1-terra(?:-(none|low|medium|high|xhigh|max))?$/i.exec(String(body.model).trim())
  const reasoning = body.reasoning && typeof body.reasoning === 'object' && !Array.isArray(body.reasoning) ? body.reasoning as Record<string, unknown> : {}
  const explicit = reasoning.effort ?? body.reasoning_effort
  const effort = explicit ?? alias?.[1]?.toLowerCase() ?? 'medium'
  if (typeof effort !== 'string' || !['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) {
    throw Object.assign(new Error('Unsupported GPT-6.1 Terra reasoning effort'), { statusCode: 400, code: 'unsupported_reasoning_effort' })
  }
  if (alias?.[1] && explicit !== undefined && explicit !== alias[1].toLowerCase()) {
    throw Object.assign(new Error('Model alias and explicit reasoning effort disagree'), { statusCode: 400, code: 'conflicting_reasoning_effort' })
  }
  if (alias) out.model = 'gpt-6.1-terra'
  if (Array.isArray(body.messages)) out.reasoning_effort = effort
  else out.reasoning = { ...reasoning, effort }
  if (effort !== 'none') for (const key of ['temperature', 'top_p', 'top_logprobs', 'logprobs']) delete out[key]
  return out
}
