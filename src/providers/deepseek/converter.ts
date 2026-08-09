/**
 * Resolves legacy client aliases for DeepSeek's Chat Completions and
 * Anthropic-compatible endpoints.
 */
export function mapModel(input: unknown): string {
  if (typeof input !== 'string' || !input) return 'deepseek-v4-pro'
  if (input === 'deepseek-chat') return 'deepseek-v4-flash'
  if (input === 'deepseek-reasoner') return 'deepseek-v4-pro'
  return input.startsWith('deepseek-') ? input : 'deepseek-v4-pro'
}

/** DeepSeek's native Responses API currently supports V4 Flash only. */
export function mapResponsesModel(input: unknown): string {
  if (typeof input === 'string' && input === 'deepseek-v4-flash') return input
  return 'deepseek-v4-flash'
}
