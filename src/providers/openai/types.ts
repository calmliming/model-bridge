/** Non-secret ChatGPT account identity parsed from the Codex OAuth id_token. */
export interface OpenAIAccountMetadata {
  chatgptAccountId?: string
  chatgptUserId?: string
  organizationId?: string
  email?: string
  planType?: string
}

/** One rate-limit window returned by the ChatGPT `wham/usage` endpoint. */
export interface OpenAIRateLimitWindow {
  used_percent?: number
  limit_window_seconds?: number
  reset_after_seconds?: number
  reset_at?: number
}

/** Subset of the `wham/usage` response that drives the quota snapshot + reset credits. */
export interface OpenAIUsageResponse {
  rate_limit?: {
    allowed?: boolean
    limit_reached?: boolean
    primary_window?: OpenAIRateLimitWindow | null
    secondary_window?: OpenAIRateLimitWindow | null
  }
  rate_limit_reset_credits?: {
    available_count?: number
  }
}

/** Result of consuming one reset credit via `rate-limit-reset-credits/consume`. */
export interface OpenAIResetCreditResult {
  windowsReset: number
}
