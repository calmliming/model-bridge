/**
 * Resolves legacy client aliases for DeepSeek's Chat Completions and
 * Anthropic-compatible endpoints.
 */
export function mapModel(input: unknown): string {
  if (typeof input !== 'string' || !input) return 'deepseek-flash'
  if (input === 'deepseek-chat' || input === 'deepseek-reasoner') return 'deepseek-flash'
  // Preserve explicit upstream names, including the temporary V4 aliases.
  // DeepSeek handles the scheduled V4 Pro routing change on its side.
  return input.startsWith('deepseek-') ? input : 'deepseek-flash'
}

/** Native Responses supports V4.1 Flash, V4 Pro, and temporary V4 Flash aliases. */
export function mapResponsesModel(input: unknown): string {
  if (
    typeof input === 'string' &&
    (input === 'deepseek-flash' ||
      input === 'deepseek-v4-flash' ||
      input === 'deepseek-v4-pro' ||
      input === 'deepseek-v4-flash-vision-exp')
  ) {
    return input
  }
  return 'deepseek-flash'
}
