const USD_MICROS = 1_000_000n
const RATE_SCALE = 10_000n

/** CNY charged per USD of wallet credit; this is the merchant's recharge rate. */
export function parseAlipayRate(value: string): bigint {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,4}))?$/)
  if (!match) throw new Error('ALIPAY_USD_CNY_RATE must be a positive decimal with up to 4 places')
  const scaled = BigInt(match[1]!) * RATE_SCALE + BigInt((match[2] ?? '').padEnd(4, '0'))
  if (scaled <= 0n) throw new Error('ALIPAY_USD_CNY_RATE must be positive')
  return scaled
}

export function usdMicrosToAlipayCny(amountMicros: number, rate: bigint): string {
  if (!Number.isSafeInteger(amountMicros) || amountMicros <= 0) {
    throw new Error('payment amount must be a positive safe integer in micro-USD')
  }
  const denominator = USD_MICROS * RATE_SCALE
  const cents = (BigInt(amountMicros) * rate * 100n + denominator / 2n) / denominator
  if (cents < 1n) throw new Error('payment amount converts to less than CNY 0.01')
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`
}

export function alipayCnyToUsd(cny: number, rate: bigint): number {
  return cny / (Number(rate) / Number(RATE_SCALE))
}
