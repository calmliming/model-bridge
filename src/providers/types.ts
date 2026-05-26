export type ProviderId = 'claude' | 'openai' | 'gemini' | 'deepseek'

/** OAuth credentials for one upstream subscription account. */
export interface TokenSet {
  accessToken: string
  refreshToken: string
  expiresAt: number // epoch ms
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
