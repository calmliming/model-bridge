/**
 * Legacy Chat Completions function calling (`functions`, `function_call`,
 * role=function) for the paths that translate Chat into another protocol.
 *
 * Requests are upgraded to the tools shape before translation, so the Responses
 * and Messages converters only handle one form. Legacy turns carry no call IDs:
 * the assistant turn has `function_call` and the result names the function, so
 * IDs are assigned in message order (stable across replays) and each result is
 * paired with the oldest unanswered call of the same name. A result with no
 * preceding call is left as-is rather than becoming an orphan tool output.
 *
 * Responses go back in the legacy shape only when the caller declared
 * `functions` without `tools`: such a client reads `message.function_call` and
 * has no use for `tool_calls`. The legacy shape holds one call per turn, so any
 * further parallel calls are dropped.
 */

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function nonEmptyArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0
}

/** True when the caller speaks only the legacy shape and expects it back. */
export function usesLegacyFunctions(body: JsonRecord): boolean {
  return nonEmptyArray(body.functions) && !nonEmptyArray(body.tools)
}

function legacyToolChoice(functionCall: unknown): unknown {
  if (typeof functionCall === 'string') return functionCall
  const name = record(functionCall)?.name
  return typeof name === 'string' && name ? { type: 'function', function: { name } } : undefined
}

/** Rewrites legacy function-calling fields into tools/tool_calls; returns the body itself when there are none. */
export function upgradeLegacyFunctionCalling(body: JsonRecord): JsonRecord {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const legacyMessages = messages.some(message => {
    const m = record(message)
    return m && ((m.role === 'assistant' && record(m.function_call)) || m.role === 'function')
  })
  if (body.functions === undefined && body.function_call === undefined && !legacyMessages) return body

  const out: JsonRecord = { ...body }
  delete out.functions
  delete out.function_call
  const functions = Array.isArray(body.functions) ? body.functions : []
  const legacyTools = functions.flatMap(fn => {
    const name = record(fn)?.name
    return typeof name === 'string' && name ? [{ type: 'function', function: fn }] : []
  })
  if (legacyTools.length) out.tools = [...(Array.isArray(body.tools) ? body.tools : []), ...legacyTools]
  if (body.tool_choice == null && body.function_call != null) {
    const choice = legacyToolChoice(body.function_call)
    if (choice !== undefined) out.tool_choice = choice
  }
  if (!legacyMessages) return out

  const used = new Set<string>()
  for (const message of messages) {
    const m = record(message)
    if (typeof m?.tool_call_id === 'string') used.add(m.tool_call_id)
    for (const call of Array.isArray(m?.tool_calls) ? m.tool_calls : []) {
      const id = record(call)?.id
      if (typeof id === 'string') used.add(id)
    }
  }
  let next = 0
  const pending = new Map<string, string[]>()
  out.messages = messages.map(message => {
    const m = record(message)
    if (!m) return message
    const call = record(m.function_call)
    if (m.role === 'assistant' && call && !nonEmptyArray(m.tool_calls)) {
      const name = typeof call.name === 'string' ? call.name : ''
      let id = ''
      while (!id || used.has(id)) id = `call_legacy_${++next}`
      used.add(id)
      pending.set(name, [...(pending.get(name) ?? []), id])
      const { function_call: _legacy, ...rest } = m
      return { ...rest, tool_calls: [{ id, type: 'function', function: {
        name, arguments: typeof call.arguments === 'string' ? call.arguments : '' } }] }
    }
    if (m.role === 'function' && typeof m.tool_call_id !== 'string') {
      const queue = pending.get(typeof m.name === 'string' ? m.name : '')
      const id = queue?.shift()
      if (!id) return message
      const { name: _name, ...rest } = m
      return { ...rest, role: 'tool', tool_call_id: id }
    }
    return message
  })
  return out
}

function legacyFinishReason(reason: unknown): unknown {
  return reason === 'tool_calls' ? 'function_call' : reason
}

/** Rewrites a buffered chat.completion body into the legacy function_call shape. */
export function legacyFunctionCallCompletion(body: unknown): unknown {
  const completion = record(body)
  if (!completion || !Array.isArray(completion.choices)) return body
  return {
    ...completion,
    choices: completion.choices.map(choice => {
      const c = record(choice)
      const message = record(c?.message)
      if (!c || !message) return choice
      const { tool_calls: calls, ...rest } = message
      const fn = record(record(Array.isArray(calls) ? calls[0] : undefined)?.function)
      return {
        ...c,
        message: fn ? { ...rest, function_call: { name: fn.name, arguments: fn.arguments } } : rest,
        finish_reason: legacyFinishReason(c.finish_reason),
      }
    }),
  }
}

/** Rewrites one chat.completion.chunk; null when nothing is left to send. */
function legacyFunctionCallChunk(event: unknown): unknown {
  const chunk = record(event)
  if (!chunk || !Array.isArray(chunk.choices)) return event
  let empty = true
  const choices = chunk.choices.map(choice => {
    const c = record(choice)
    const delta = record(c?.delta)
    if (!c || !delta) return choice
    const { tool_calls: calls, ...rest } = delta
    const first = Array.isArray(calls) ? calls.map(record).find(call => call?.index === 0) : undefined
    const fn = record(first?.function)
    const legacy = fn ? { ...rest, function_call: {
      ...(fn.name !== undefined ? { name: fn.name } : {}), arguments: fn.arguments ?? '' } } : rest
    if (Object.keys(legacy).length || c.finish_reason != null || !Array.isArray(calls)) empty = false
    return { ...c, delta: legacy, finish_reason: legacyFinishReason(c.finish_reason) }
  })
  return empty ? null : { ...chunk, choices }
}

/** Wraps a Chat stream transform so it emits legacy function_call deltas. */
export function legacyFunctionCallStream<T extends { transform(data: unknown): unknown[]; flush(...args: never[]): unknown[] }>(inner: T): T {
  const convert = (events: unknown[]) => events.map(legacyFunctionCallChunk).filter(event => event !== null)
  return {
    ...inner,
    transform: (data: unknown) => convert(inner.transform(data)),
    flush: (...args: never[]) => convert(inner.flush(...args)),
  }
}
