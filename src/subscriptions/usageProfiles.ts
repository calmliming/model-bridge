/** OpenCode Go benchmark checked 2026-09-29: https://opencode.ai/docs/go/#usage-limits */
export type SubscriptionUsageProfile = 'base' | 'opencode-go'

export function goUsageLimits(priceUsd: number) {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) throw new Error('plan price must be finite and positive')
  const scale = priceUsd / 10
  return { fiveHour: 12_000 * scale, weekly: 30_000 * scale, monthly: 60_000 * scale }
}

export function subscriptionModelMultiplier(profile: SubscriptionUsageProfile, model: string): number {
  if (profile !== 'opencode-go') return 1
  const id = model.trim().toLowerCase().replace(/\[[^\]]+\]$/, '')
  // Specific variants must precede their family names.
  if (/^deepseek-v4-flash-vision(?:$|-)/.test(id)) return 4
  if (/^deepseek-v4-flash(?:$|-)/.test(id)) return 2
  if (/^qwen3[.-]8-flash(?:$|-)/.test(id) || /^hy4(?:$|-)/.test(id)) return 2
  const standardModels = [
    /^deepseek-(?:v4[.-]1-flash|flash|chat|reasoner)(?:$|-)/,
    /^glm-5[.-]3-flash(?:$|-)/,
    /^glm-5[.-]2(?:$|-)/,
    /^kimi-k2[.-](?:7-code|6)(?:$|-)/,
    /^longcat-2[.-]0(?:$|-)/,
    /^mimo-v2[.-]6-flash(?:$|-)/,
    /^mimo-v2[.-]5$/,
    /^minimax-m(?:3|2[.-]7)(?:$|-)/,
    /^muse-spark-1[.-](?:2|3)-contributor(?:$|-)/,
    /^qwen3[.-]7-plus(?:$|-)/,
    /^hy3(?:$|-)/,
  ]
  if (standardModels.some(pattern => pattern.test(id))) return 1
  // Includes Go's $15 models. For unlisted models, 4x is our conservative
  // extension, not a claim that OpenCode includes those models or offers this price.
  return 4
}

export function subscriptionUsageBands(profile: SubscriptionUsageProfile, monthlyPoints: number | null) {
  if (profile !== 'opencode-go') return []
  return [
    { multiplier: 1, label: '1 倍扣点', examples: 'DeepSeek V4.1 Flash、MiniMax M3、Kimi K2.7 Code' },
    { multiplier: 2, label: '2 倍扣点', examples: 'DeepSeek V4 Flash（旧型号）、Qwen3.8 Flash' },
    { multiplier: 4, label: '4 倍扣点', examples: 'Kimi K3、Grok 4.7、GPT 6 Luna；未列模型默认同档' },
  ].map(band => ({ ...band, monthlyReferenceUsd: monthlyPoints == null ? null : monthlyPoints / 1000 / band.multiplier }))
}
