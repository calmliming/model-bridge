// ── xAI (Grok) OAuth + API constants ───────────────────────────────
// Grok is onboarded as an xAI subscription account via the public grok-cli
// OAuth client (Authorization Code + PKCE against auth.x.ai), then relayed to
// the official xAI API at api.x.ai/v1. This is not a grok.com private reverse
// engineering — requests only need the OAuth Bearer token, no browser-level
// spoofing headers. Endpoints can be overridden via env for future-proofing.
export const GROK_AUTHORIZE_URL = process.env.XAI_OAUTH_AUTHORIZE_URL ?? 'https://auth.x.ai/oauth2/authorize'
export const GROK_TOKEN_URL = process.env.XAI_OAUTH_TOKEN_URL ?? 'https://auth.x.ai/oauth2/token'
export const GROK_CLIENT_ID = process.env.XAI_OAUTH_CLIENT_ID ?? 'b1a00492-073a-47ea-816f-4c329264a828'
export const GROK_SCOPE =
  process.env.XAI_OAUTH_SCOPE ?? 'openid profile email offline_access grok-cli:access api:access'
export const GROK_REDIRECT_URI = process.env.XAI_OAUTH_REDIRECT_URI ?? 'http://127.0.0.1:56121/callback'

// Base URL for the xAI API (no trailing slash). Defaults to the official host.
export const GROK_BASE_URL = (process.env.XAI_BASE_URL ?? 'https://api.x.ai/v1').replace(/\/+$/, '')

export const GROK_RESPONSES_URL = `${GROK_BASE_URL}/responses`
export const GROK_CHAT_COMPLETIONS_URL = `${GROK_BASE_URL}/chat/completions`
export const GROK_MODELS_URL = `${GROK_BASE_URL}/models`

// api.x.ai is the official API and does not gate on User-Agent, so these are
// plain identifiers rather than a spoofed client string.
export const GROK_USER_AGENT = 'model-bridge-grok/1.0'
export const GROK_OAUTH_USER_AGENT = 'model-bridge-grok-oauth/1.0'

// Bare "grok" (and unknown aliases) resolve to the current flagship.
export const GROK_DEFAULT_MODEL = 'grok-4.5'
