import type { UsageData } from '../providers/types'

/** USD price per 1M tokens, by model tier. */
interface TierPrice {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

// Anthropic list prices. Editable per-model pricing (the model_pricing
// table + Settings UI) arrives in Phase E.
const CLAUDE_TIERS: Record<'opus' | 'sonnet' | 'haiku', TierPrice> = {
  opus: { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  sonnet: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  haiku: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
}

function claudeTier(model: string): keyof typeof CLAUDE_TIERS {
  const m = model.toLowerCase()
  if (m.includes('opus')) return 'opus'
  if (m.includes('haiku')) return 'haiku'
  return 'sonnet'
}

/** Estimates the USD cost of one request from its token usage. */
export function estimateCost(provider: string, model: string, usage: UsageData): number {
  if (provider !== 'claude') return 0 // OpenAI / Gemini pricing lands in Phase C/D
  const p = CLAUDE_TIERS[claudeTier(model)]
  const cost =
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheCreateTokens * p.cacheWrite +
      usage.cacheReadTokens * p.cacheRead) /
    1_000_000
  return Math.round(cost * 1e6) / 1e6
}
