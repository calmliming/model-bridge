const MAP_KEYS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'])
const NODE_KEYS = new Set(['items', 'additionalProperties', 'additionalItems', 'contains', 'not', 'if', 'then', 'else',
  'propertyNames', 'unevaluatedProperties', 'unevaluatedItems', 'contentSchema'])
const LIST_KEYS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems'])

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** Visit schema positions only: defaults, enum values and property names are user data. */
export function cleanNullRequired(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanNullRequired)
  const schema = record(value)
  if (!schema) return value
  return Object.fromEntries(Object.entries(schema).flatMap(([key, child]) => {
    if (key === 'required' && child === null) return []
    if (MAP_KEYS.has(key) && record(child)) {
      return [[key, Object.fromEntries(Object.entries(child as Record<string, unknown>)
        .map(([name, item]) => [name, cleanNullRequired(item)]))]]
    }
    // Draft-07 dependencies can contain either schemas or lists of names.
    if (key === 'dependencies' && record(child)) {
      return [[key, Object.fromEntries(Object.entries(child as Record<string, unknown>)
        .map(([name, item]) => [name, record(item) ? cleanNullRequired(item) : item]))]]
    }
    return [[key, NODE_KEYS.has(key) || LIST_KEYS.has(key) ? cleanNullRequired(child) : child]]
  }))
}

/** Normalize only tool schemas; leave prompts, tool arguments and gateway passthrough untouched. */
export function sanitizeToolSchemas(body: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(body.tools)) return body
  const tools = body.tools.map(raw => {
    const tool = record(raw)
    if (!tool) return raw
    const next = { ...tool }
    for (const key of ['parameters', 'input_schema']) {
      if (record(tool[key])) next[key] = cleanNullRequired(tool[key])
    }
    const fn = record(tool.function)
    if (fn && record(fn.parameters)) next.function = { ...fn, parameters: cleanNullRequired(fn.parameters) }
    return next
  })
  return { ...body, tools }
}

/**
 * Anthropic disallows root unions. Project their object fields into one object;
 * variant-specific required fields become optional. Nested unions stay intact.
 * Cross-property branch correlations cannot be expressed by this projection.
 */
export function anthropicToolSchema(value: unknown): Record<string, unknown> {
  const schema = record(cleanNullRequired(value)) ?? { type: 'object', properties: {} }
  const properties: Record<string, unknown> = Object.assign(Object.create(null), record(schema.properties))
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((name): name is string => typeof name === 'string') : [])
  let changed = false
  for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
    if (!(keyword in schema)) continue
    changed = true
    const branches = Array.isArray(schema[keyword]) ? schema[keyword] as unknown[] : []
    delete schema[keyword]
    const objects = branches.map(branch => {
      const item = record(branch)
      return item && (item.type == null || item.type === 'object') ? anthropicToolSchema(item) : null
    })
    const names = new Set(objects.flatMap(item => Object.keys(record(item?.properties) ?? {})))
    for (const name of names) {
      const variants = objects.flatMap(item => {
        const props = record(item?.properties)
        return props && Object.hasOwn(props, name) ? [props[name]] : []
      })
      const unique = [...new Map(variants.map(item => [JSON.stringify(item), item])).values()]
      const merged = unique.length === 1 ? unique[0] : { [keyword === 'allOf' ? 'allOf' : 'anyOf']: unique }
      properties[name] = Object.hasOwn(properties, name) ? { allOf: [properties[name], merged] } : merged
    }
    const lists = objects.map(item => Array.isArray(item?.required) ? item.required as string[] : [])
    const common = keyword === 'allOf' ? lists.flat() : (lists[0] ?? []).filter(name => lists.every(list => list.includes(name)))
    for (const name of common) required.add(name)
  }
  if (schema.type == null) schema.type = 'object'
  if (changed) {
    schema.properties = properties
    if (required.size) schema.required = [...required]
    else delete schema.required
  }
  return schema
}
