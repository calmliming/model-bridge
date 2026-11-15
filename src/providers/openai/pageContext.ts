type Row = Record<string, unknown>
const row = (value: unknown): Row | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null
const selectedPage = /^codex_apps_selected_page_part_([1-9][0-9]*)_of_([1-9][0-9]*)$/

/** Validate the envelope only; the snapshot itself is forwarded verbatim. */
function validSnapshot(text: string): boolean {
  try {
    const snapshot = row(JSON.parse(text))
    if (!snapshot || !('page_id' in snapshot) || !(snapshot.page_id === null ||
      (typeof snapshot.page_id === 'string' && snapshot.page_id.trim()))) return false
    // JSON.parse accepts duplicate members. Do not reinterpret ambiguous context.
    // Tokenize complete strings first so braces/colons inside values are ignored.
    const objects: Array<Set<string> | null> = []
    for (const token of text.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\]]/g)) {
      const value = token[0]
      if (value === '{') objects.push(new Set())
      else if (value === '[') objects.push(null)
      else if (value === '}' || value === ']') objects.pop()
      else {
        let next = token.index + value.length
        while (next < text.length && /[ \t\r\n]/.test(text[next]!)) next++
        const keys = objects.at(-1)
        if (text[next] === ':' && keys) {
          const key = JSON.parse(value) as string
          if (keys.has(key)) return false
          keys.add(key)
        }
      }
    }
    return true
  } catch { return false }
}

function validPageContext(name: string, output: string): boolean {
  if (name === 'codex_apps_open_page') return validSnapshot(output)
  const match = selectedPage.exec(name)
  if (!match) return false
  const part = Number(match[1]), total = Number(match[2])
  if (!Number.isSafeInteger(part) || !Number.isSafeInteger(total) || part > total) return false
  const newline = output.indexOf('\n')
  if (newline < 0 || output.slice(0, newline).replace(/\r$/, '') !== `Companion Page snapshot part ${part} of ${total}:`) return false
  const snapshot = output.slice(newline + 1)
  // Multipart fragments can split within a JSON string; keep each intact.
  return !!snapshot.trim() && (total > 1 || validSnapshot(snapshot))
}

/** Desktop page snapshots are external user context, not model-issued tool results. */
export function normalizeCodexPageContext(body: Row): Row {
  if (!Array.isArray(body.input)) return body
  let changed = false
  const input = body.input.map(raw => {
    const item = row(raw)
    if (!item || item.type !== 'function_call_output' || item.namespace !== 'agent' ||
      typeof item.name !== 'string' || typeof item.output !== 'string') return raw
    if ('call_id' in item && (typeof item.call_id !== 'string' || item.call_id.trim())) return raw
    if (!validPageContext(item.name, item.output)) return raw
    changed = true
    return { type: 'message', role: 'user', content: [{ type: 'input_text',
      text: `<external_${item.name}>\n${item.output}\n</external_${item.name}>` }] }
  })
  return changed ? { ...body, input } : body
}
