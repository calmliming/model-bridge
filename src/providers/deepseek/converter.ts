/**
 * DeepSeek model names accepted by the upstream API. The catalog mirrors the
 * names seeded in `usage/pricing.ts`; a request carrying any other deepseek-*
 * name is rejected here rather than forwarded upstream (where it only earns a
 * confusing 400). Non-DeepSeek names are cross-provider aliases and still fall
 * back to the current Flash model.
 */
// Mirrors the exact rows seeded in `usage/pricing.ts` and the cards in
// `web/src/catalog/modelCatalog.ts`. Names that only appear in the pricing
// fallback logic (deepseek-v4.1-pro, deepseek-v4-flash-thinking) are pricing's
// forward compatibility, not proof the upstream serves them today — leave them
// out so an unknown name fails here rather than upstream.
const DEEPSEEK_MODELS = new Set(['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'])

export class DeepseekRequestError extends Error {
  readonly statusCode = 400
  readonly code = 'invalid_deepseek_model'
}

/** Claude Code's [1m] selector is client metadata, not an upstream model ID. */
function normalizeModelName(model: string): string {
  return model.trim().toLowerCase().replace(/(?:\[1m\])+$/, '')
}

/** Resolves legacy client aliases for DeepSeek's Chat Completions and
 * Anthropic-compatible endpoints. */
export function mapModel(input: unknown): string {
  if (typeof input !== 'string' || !input) return 'deepseek-flash'
  const model = normalizeModelName(input)
  if (model === 'deepseek-chat' || model === 'deepseek-reasoner') return 'deepseek-flash'
  if (DEEPSEEK_MODELS.has(model)) return model
  if (model.startsWith('deepseek-')) {
    throw new DeepseekRequestError(`Unsupported DeepSeek model: ${input}. Supported: ${[...DEEPSEEK_MODELS].join(', ')}`)
  }
  // A cross-provider alias (e.g. gpt-5.5): route it to the current Flash model.
  return 'deepseek-flash'
}

/**
 * Native Responses accepts the same names as the Chat Completions and
 * Anthropic surfaces, so it shares `mapModel`'s resolution — including the
 * rejection of unknown `deepseek-*` names. Keeping a second, laxer fallback
 * here meant one model string was a hard 400 on `/v1/messages` and a silent
 * wrong-model bill on `/v1/responses`.
 */
export function mapResponsesModel(input: unknown): string {
  return mapModel(input)
}

/**
 * Non-throwing counterpart to `mapModel`, for the discovery layer.
 *
 * The account catalog syncs whatever the upstream `/models` endpoint returns
 * (every 6 hours, and it replaces the provider's list wholesale), so without
 * this the gateway advertises names in `GET /v1/models` that it then answers
 * with a 400. Names outside the `deepseek-` prefix are cross-provider aliases
 * and are still routed to Flash, so they stay advertised.
 */
export function isForwardableDeepseekModel(model: string): boolean {
  const normalized = normalizeModelName(model)
  if (DEEPSEEK_MODELS.has(normalized) || normalized === 'deepseek-chat' || normalized === 'deepseek-reasoner') return true
  return !normalized.startsWith('deepseek-')
}
