const providers = new Set(['kimi', 'zhipu', 'qwen', 'minimax', 'xiaomi', 'deepseek'])
const exhausted = /insufficient[_ ](?:balance|quota)|余额不足|额度.{0,12}(?:耗尽|用尽|用完)|套餐.{0,12}(?:耗尽|用尽)|quota.{0,20}(?:exhaust|exceed)|weekly.limit|daily.limit/i
const frequency = /请求频率|访问频率|速率限制|请求过于频繁|too many requests|rate[_ ]limit|concurren(?:t|cy).{0,40}limit/i

export function isCNQuotaExhausted(provider: string, status: number, text: string): boolean {
  return providers.has(provider) && [402, 403, 429].includes(status) && exhausted.test(text)
}

/** Only strong provider-local frequency evidence overrides the generic cooldown. */
export function isCNFrequencyLimit(provider: string, status: number, text: string): boolean {
  if (!providers.has(provider) || exhausted.test(text)) return false
  if (status === 403) {
    if (provider !== 'kimi') return false
    try { text = JSON.parse(text)?.error?.message ?? text } catch { /* plain text */ }
    return text.replace(/\s+/g, ' ').trim() === "You've reached your concurrent request limit. Please wait for your ongoing requests to finish and try again."
  }
  return status === 429 && frequency.test(text)
}
