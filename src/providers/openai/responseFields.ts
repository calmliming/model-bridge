type Row = Record<string, unknown>

function row(value: unknown): Row | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null
}

/** Repair only absent/null fields; complete native payloads retain their bytes. */
export function createResponsesFieldNormalizer() {
  let timestamp: number | undefined
  let sequence = 0
  const createdAt = () => timestamp ??= Math.floor(Date.now() / 1000)
  const response = (value: Row): Row => {
    if (typeof value.created_at === 'number' && Number.isFinite(value.created_at)) timestamp ??= value.created_at
    return value.created_at == null ? { ...value, created_at: createdAt() } : value
  }
  const event = (value: unknown): unknown => {
    const object = row(value)
    if (!object || typeof object.type !== 'string' || !object.type.startsWith('response.')) return value
    let out = object
    const payload = row(object.response)
    if (payload) {
      const normalized = response(payload)
      if (normalized !== payload) out = { ...out, response: normalized }
    }
    if (object.sequence_number == null) out = { ...out, sequence_number: sequence++ }
    else if (typeof object.sequence_number === 'number' && Number.isFinite(object.sequence_number)) {
      sequence = Math.max(sequence, object.sequence_number + 1)
    }
    return out
  }
  return {
    createdAt,
    nextSequenceNumber: () => sequence,
    event,
    json(value: unknown): unknown {
      const object = row(value)
      if (!object) return value
      const payload = row(object.response)
      if (payload) {
        const normalized = response(payload)
        return normalized === payload ? value : { ...object, response: normalized }
      }
      return object.object === 'response' || 'output' in object || 'usage' in object ? response(object) : value
    },
    sseBlock(block: string): string {
      const lines = block.split('\n')
      const data = lines.filter(line => line.trimStart().startsWith('data:'))
        .map(line => line.trimStart().slice(5).trimStart()).join('\n').trim()
      if (!data || data === '[DONE]') return block
      let parsed: unknown
      try { parsed = JSON.parse(data) } catch { return block }
      const normalized = event(parsed)
      if (normalized === parsed) return block
      let emitted = false
      return lines.flatMap(line => {
        if (!line.trimStart().startsWith('data:')) return [line]
        if (emitted) return []
        emitted = true
        return [`data: ${JSON.stringify(normalized)}`]
      }).join('\n')
    },
  }
}
