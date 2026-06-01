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
