export const RECHARGE_PRESETS = [10, 30, 50, 100, 200] as const

export interface BillingPlan {
  id: string
  name: string
  description: string | null
  price: number
  validityDays: number
  dailyLimitUsd: number | null
  weeklyLimitUsd: number | null
  monthlyLimitUsd: number | null
  groupName?: string | null
  paymentProvider: 'wallet' | 'waffo'
  checkoutAvailable?: boolean
  quotaMode: 'spend' | 'usage'
  fiveHourLimitPoints: number | null
  weeklyLimitPoints: number | null
  monthlyLimitPoints: number | null
}

export interface SubscriptionUsageWindow {
  key: 'fiveHour' | 'weekly' | 'monthly'
  limit: number | null
  used: number
  remaining: number | null
  percent: number
  resetsAt: number | null
  startedAt: number | null
}

export function quotaRatio(limit: number | null, baseline: number): string {
  return limit == null ? '不限' : `${(limit / baseline).toLocaleString('en-US', { maximumFractionDigits: 2 })}× 标准`
}

export function isWaffoCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['checkout.waffo.ai', 'pancake.waffo.ai'].includes(url.hostname)
  } catch { return false }
}
