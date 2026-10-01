import { formatUsd } from './utils'

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
  usageProfile?: 'base' | 'opencode-go'
  usageBands?: Array<{ multiplier: number; label: string; examples: string; monthlyReferenceUsd: number | null }>
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

/** Quotas are stored as points server-side; users only ever see the dollar value at model list price. */
export const USAGE_POINTS_PER_USD = 1000

export function usagePointsToUsd(points: number): number {
  return points / USAGE_POINTS_PER_USD
}

export function usdToUsagePoints(usd: number): number {
  return Math.round(usd * USAGE_POINTS_PER_USD)
}

export function formatUsageQuota(points: number | null): string {
  return points == null ? '不限' : `$${usagePointsToUsd(points).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

/** Per-request subscription consumption, labeled so it isn't mistaken for a wallet charge. */
export function formatSubscriptionUsage(points: number): string {
  return `套餐 ${formatUsd(usagePointsToUsd(points))}`
}

export function isWaffoCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['checkout.waffo.ai', 'pancake.waffo.ai'].includes(url.hostname)
  } catch { return false }
}
