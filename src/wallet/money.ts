export const MICRO_USD = 1_000_000

export function usdToMicros(usd: number): number {
  if (!Number.isFinite(usd)) {
    throw new Error('amount must be a finite number')
  }
  return Math.round(usd * MICRO_USD)
}

export function microsToUsd(micros: number): number {
  return Math.round(micros) / MICRO_USD
}

/**
 * Rounds a USD amount to the wallet's smallest representable unit.
 *
 * Every ledger that stores or charges a cost must round here, not to a literal
 * of its own: a cost recorded at finer precision than the wallet can debit
 * makes `usage_logs.cost` and `api_keys.quota_used` diverge from
 * `wallet_transactions.amount_micros`. A request can then consume quota without
 * ever charging — and `SUM(usage_logs.cost)` no longer reconciles against the
 * wallet. Rounding to micros keeps the three ledgers exactly equal.
 */
export function roundUsd(usd: number): number {
  return Math.round(usd * MICRO_USD) / MICRO_USD
}
