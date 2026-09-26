function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

function wildcardMatch(pattern: string, model: string): boolean {
  const regex = new RegExp(`^${pattern.split('*').map(escapeRegex).join('.*')}$`, 'i')
  return regex.test(model)
}

export type ModelMappings = Record<string, string>

export function normalizeModelMappings(input: unknown): ModelMappings | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const out: ModelMappings = {}
  for (const [rawFrom, rawTo] of Object.entries(input as Record<string, unknown>)) {
    if (typeof rawTo !== 'string') continue
    const from = rawFrom.trim()
    const to = rawTo.trim()
    if (!from || !to) continue
    out[from] = to
  }
  return Object.keys(out).length ? out : null
}

/**
 * Maps a client-facing model name to the upstream model configured on the API
 * key. Exact entries win; wildcard sources such as `gpt-4*` map to a fixed
 * upstream model.
 */
export function mapRequestedModel(
  model: string,
  mappings: ModelMappings | null | undefined,
): string {
  return findModelMapping(model, mappings) ?? model.trim()
}

/** Distinguishes explicit identity mappings from the unmapped fallback. */
export function findModelMapping(model: string, mappings: ModelMappings | null | undefined): string | undefined {
  const requested = model.trim()
  if (!requested || !mappings) return undefined

  for (const [from, to] of Object.entries(mappings)) {
    if (from.includes('*')) continue
    if (from.trim().toLowerCase() === requested.toLowerCase()) return to.trim()
  }
  for (const [from, to] of Object.entries(mappings)) {
    const source = from.trim()
    const target = to.trim()
    if (source.includes('*') && target && wildcardMatch(source, requested)) return target
  }
  return undefined
}
