import type { UsageData, UsageSource } from './types'
type Row = Record<string, unknown>
const row = (v: unknown): Row | null => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : null
const countKeys = ['input_tokens', 'output_tokens', 'prompt_tokens', 'completion_tokens', 'cache_creation_input_tokens',
  'cache_read_input_tokens', 'promptTokenCount', 'candidatesTokenCount', 'totalTokenCount', 'thoughtsTokenCount']
export const hasReportedUsage = (value: unknown): boolean => {
  const u = row(value)
  return !!u && countKeys.some(k => typeof u[k] === 'number' && Number.isFinite(u[k]) && (u[k] as number) >= 0)
}

/** Observe protocol metadata, never infer presence from a positive token count. */
export function createUsageSourceTracker() {
  let seen = false, finalUsage = false, geminiTerminal = false, claudeOutput = false
  return {
    feed(value: unknown, buffered = false) {
      const root = row(value)
      if (!root) return
      const response = row(root.response)
      const message = row(root.message)
      const type = typeof root.type === 'string' ? root.type : ''
      const usage = root.usage ?? response?.usage ?? message?.usage ?? root.usageMetadata ?? response?.usageMetadata
      const hasUsage = hasReportedUsage(usage)
      seen ||= hasUsage
      const candidates = root.candidates ?? response?.candidates
      const geminiDone = Array.isArray(candidates) && candidates.some(c => !!row(c)?.finishReason)
      const responseDone = ['response.completed', 'response.failed', 'response.incomplete'].includes(type)
      geminiTerminal ||= geminiDone
      const u = row(usage)
      if (type === 'message_delta' && typeof u?.output_tokens === 'number') claudeOutput = true
      const claudeTerminal = type === 'message_stop' || !!row(root.delta)?.stop_reason
      // Final evidence is protocol-specific. A Responses terminal without usage
      // must not promote an earlier partial snapshot to a complete count.
      finalUsage ||= (claudeTerminal && claudeOutput) || (hasUsage && (
        buffered || responseDone || geminiTerminal ||
        /(?:image_generation|image_generation_call)\.completed$/.test(type) ||
        (typeof u?.prompt_tokens === 'number' && typeof u?.completion_tokens === 'number')
      ))
    },
    source(_interrupted = false): UsageSource {
      return !seen ? 'missing' : finalUsage ? 'upstream' : 'partial'
    },
  }
}

export function trackUsageParser<T extends { feed(event: unknown): void; result(): UsageData }>(parser: T) {
  const tracker = createUsageSourceTracker()
  return {
    ...parser,
    feed(event: unknown) { tracker.feed(event); parser.feed(event) },
    result(interrupted = false): UsageData { return { ...parser.result(), usageSource: tracker.source(interrupted) } },
  }
}

export function jsonUsageSource(body: unknown): UsageSource {
  const tracker = createUsageSourceTracker()
  tracker.feed(body, true)
  return tracker.source()
}

export function bufferedUsageSource(text: string, sse: boolean): UsageSource {
  if (!sse) {
    try { return jsonUsageSource(JSON.parse(text)) } catch { return 'missing' }
  }
  const tracker = createUsageSourceTracker()
  for (const block of text.replace(/\r\n/g, '\n').split('\n\n')) {
    const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n')
    try { tracker.feed(JSON.parse(data)) } catch { /* [DONE] or malformed frame */ }
  }
  return tracker.source()
}
