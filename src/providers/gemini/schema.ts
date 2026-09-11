export class GeminiSchemaError extends Error {
  readonly statusCode = 400
  readonly code = 'invalid_tool_schema'
}

/** Resolve local JSON Pointers before removing definitions from Gemini tool schemas. */
export function expandLocalSchemaReferences(root: unknown): unknown {
  let remaining = 5000
  const expand = (value: unknown, refs: Set<string>, depth: number): unknown => {
    if (--remaining < 0 || depth > 40) throw new GeminiSchemaError('Tool schema exceeds the supported expansion limit')
    if (Array.isArray(value)) return value.map(item => expand(item, refs, depth + 1))
    if (!value || typeof value !== 'object') return value
    let input = value as Record<string, unknown>
    if (typeof input.$ref === 'string') {
      const ref = input.$ref
      if (!ref.startsWith('#/') || refs.has(ref)) throw new GeminiSchemaError('Tool schema contains an external or recursive reference')
      let target = root
      for (const part of ref.slice(2).split('/')) {
        const key = part.replace(/~1/g, '/').replace(/~0/g, '~')
        if (!target || typeof target !== 'object' || !Object.hasOwn(target, key)) {
          throw new GeminiSchemaError('Tool schema contains an unresolved local reference')
        }
        target = Reflect.get(target, key)
      }
      if (!target || typeof target !== 'object' || Array.isArray(target)) {
        throw new GeminiSchemaError('Tool schema reference must resolve to a schema object')
      }
      const resolved = expand(target, new Set([...refs, ref]), depth + 1) as Record<string, unknown>
      const { $ref: _, ...siblings } = input
      input = { ...resolved, ...siblings }
      if (resolved.properties && siblings.properties) {
        input.properties = { ...resolved.properties as object, ...siblings.properties as object }
      }
      if (Array.isArray(resolved.required) && Array.isArray(siblings.required)) {
        input.required = [...new Set([...resolved.required, ...siblings.required])]
      }
    }
    return Object.fromEntries(Object.entries(input)
      .filter(([key]) => !['$defs', 'definitions'].includes(key))
      .map(([key, value]) => [key, expand(value, refs, depth + 1)]))
  }
  return expand(root, new Set(), 0)
}
