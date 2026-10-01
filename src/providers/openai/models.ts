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
  return reasoningEffort === 'none' && typeof model === 'string' && /^gpt-6-(?:sol|luna)(?:$|-)/i.test(model.trim())
}
