import { setTimeout as delay } from 'node:timers/promises'

const TRANSIENT_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN',
  '57P01', '57P02', '57P03', '53300', '08000', '08001', '08003', '08006',
])

/** Bounded startup retry; authentication/schema errors must still fail immediately. */
export async function waitForDatabase(
  database: { query(sql: string): Promise<unknown> },
  options: { attempts?: number; delayMs?: number } = {},
): Promise<void> {
  const attempts = options.attempts ?? 5
  const baseDelay = options.delayMs ?? 500
  for (let attempt = 1; ; attempt++) {
    try {
      await database.query('SELECT 1')
      return
    } catch (error) {
      const code = (error as { code?: string })?.code
      if (attempt >= attempts || !code || !TRANSIENT_CODES.has(code)) throw error
      console.warn(`[db] temporarily unavailable (${code}); retry ${attempt}/${attempts - 1}`)
      await delay(Math.min(baseDelay * 2 ** (attempt - 1), 5_000))
    }
  }
}
