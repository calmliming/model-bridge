import { ProviderRequestError } from '../requestError'

// https://github.com/zai-org/GLM-5/blob/main/README.md (2026-09-26).
export function zhipuResponsesEffort(body: Record<string, unknown>, model: string): string | undefined {
  const reasoning = body.reasoning && typeof body.reasoning === 'object' && !Array.isArray(body.reasoning)
    ? body.reasoning as Record<string, unknown> : null
  const native = reasoning?.effort
  const legacy = body.reasoning_effort
  if (native === undefined && legacy === undefined) return undefined
  if (native !== undefined && legacy !== undefined && native !== legacy) {
    throw new ProviderRequestError('invalid_reasoning_effort', 'reasoning.effort and reasoning_effort must agree when both are supplied.')
  }
  const effort = native ?? legacy
  const allowed = /^glm-5\.3(?:$|-)/i.test(model) ? ['low', 'high', 'max']
    : /^glm-5\.2(?:$|-)/i.test(model) ? ['high', 'max'] : []
  if (typeof effort !== 'string' || !allowed.includes(effort)) {
    throw new ProviderRequestError('invalid_reasoning_effort', `Unsupported reasoning effort for ${model}${allowed.length ? `; expected ${allowed.join(', ')}` : ''}.`)
  }
  return effort
}
