function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

function wildcardMatch(pattern: string, model: string): boolean {
  const regex = new RegExp(`^${pattern.split('*').map(escapeRegex).join('.*')}$`, 'i')
  return regex.test(model)
}

/**
 * Returns true when an API key may use `model`.
 *
 * Empty / null allow-lists keep the historical behavior: all models are
 * allowed. Entries support exact names and `*` wildcards, e.g. `gpt-5*`.
 */
export function isAllowedModel(model: string, allowedModels: string[] | null | undefined): boolean {
  if (!allowedModels || allowedModels.length === 0) return true
  const normalizedModel = model.trim()
  if (!normalizedModel) return false

  return allowedModels.some((entry) => {
    const pattern = entry.trim()
    if (!pattern) return false
    if (pattern === '*') return true
    return pattern.includes('*')
      ? wildcardMatch(pattern, normalizedModel)
      : pattern.toLowerCase() === normalizedModel.toLowerCase()
  })
}
