/**
 * Lightweight local estimator for the Responses input_tokens preflight API.
 *
 * This intentionally does not claim tokenizer-level accuracy. The endpoint is
 * useful for clients that need a bounded estimate before sending a request;
 * final billing still comes from the upstream usage event.
 */

const MAX_ESTIMATE = 10_000_000

function estimateText(value: string): number {
  let asciiRun = 0
  let tokens = 0

  const flushAscii = () => {
    if (asciiRun > 0) {
      tokens += Math.ceil(asciiRun / 4)
      asciiRun = 0
    }
  }

  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint >= 0x2e80 || codePoint > 0xffff) {
      flushAscii()
      tokens += 1
    } else if (/\s/u.test(character)) {
      flushAscii()
      tokens += 1
    } else {
      asciiRun += 1
    }
  }
  flushAscii()
  return tokens
}

function estimateValue(value: unknown, seen: Set<object>): number {
  if (typeof value === 'string') return estimateText(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) {
    return value == null ? 0 : 1
  }
  if (typeof value !== 'object') return 0
  if (seen.has(value)) return 0
  seen.add(value)

  let total = 1 // JSON structure contributes a small, stable framing cost.
  if (Array.isArray(value)) {
    for (const item of value) total += estimateValue(item, seen)
  } else {
    for (const [key, item] of Object.entries(value)) {
      total += estimateText(key) + estimateValue(item, seen)
    }
  }
  seen.delete(value)
  return total
}

/** Estimates the input portion of a Responses API request in tokens. */
export function estimateResponsesInputTokens(body: Record<string, unknown>): number {
  const input = { ...body }
  // `model` identifies the route and is not part of the prompt token budget.
  delete input.model
  const estimate = estimateValue(input, new Set())
  return Math.min(MAX_ESTIMATE, Math.max(0, Math.trunc(estimate)))
}
