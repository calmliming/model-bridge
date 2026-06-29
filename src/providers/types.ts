export type ProviderId = 'claude' | 'openai' | 'gemini' | 'deepseek' | 'xiaomi' | 'zhipu' | 'qwen'

/** OAuth credentials for one upstream subscription account. */
export interface TokenSet {
  accessToken: string
  refreshToken: string
  expiresAt: number // epoch ms
  /**
   * Non-secret provider metadata derived during the token exchange/refresh
   * (e.g. OpenAI's ChatGPT account identity from the id_token). Merged into
   * `accounts.metadata` on create and refresh. Never carries secrets.
   */
  metadata?: Record<string, unknown>
}

/** Token counts extracted from one relayed request. */
export interface UsageData {
  inputTokens: number
  outputTokens: number
  cacheCreateTokens: number
  cacheReadTokens: number
}

export function emptyUsage(): UsageData {
  return { inputTokens: 0, outputTokens: 0, cacheCreateTokens: 0, cacheReadTokens: 0 }
}

/**
 * Builds UsageData for providers whose total input includes cache hits and
 * whose usage payload exposes only cached-input reads, not cache writes.
 */
export function usageWithCachedInput(
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  cachedInputTokens: number | undefined,
): UsageData {
  const input = Math.max(0, inputTokens ?? 0)
  const cached = Math.max(0, cachedInputTokens ?? 0)
  const cacheRead = input > 0 ? Math.min(cached, input) : cached
  return {
    inputTokens: Math.max(0, input - cacheRead),
    outputTokens: Math.max(0, outputTokens ?? 0),
    cacheCreateTokens: 0,
    cacheReadTokens: cacheRead,
  }
}
