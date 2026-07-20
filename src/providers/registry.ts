import * as claudeOauth from './claude/oauth'
import * as openaiOauth from './openai/oauth'
import * as geminiOauth from './gemini/oauth'
import * as grokOauth from './grok/oauth'
import type { TokenSet } from './types'

function notSupported(method: string): never {
  throw new Error(`API-key providers do not use OAuth (called: ${method})`)
}

/** OAuth surface every provider exposes for account onboarding. */
export interface OAuthProvider {
  id: string
  /**
   * How the dashboard finishes the OAuth flow:
   *   - 'paste'    — user pastes the code from the provider's display page (Claude).
   *   - 'callback' — provider redirects to localhost:1455 and the relay completes it (OpenAI, Gemini).
   */
  mode: 'paste' | 'callback'
  generatePkce(): { verifier: string; challenge: string }
  buildAuthorizeUrl(state: string, challenge: string): string
  exchangeCode(code: string, verifier: string, state: string): Promise<TokenSet>
  refreshToken(refreshToken: string): Promise<TokenSet>
  /**
   * Optional: fetch provider-specific data needed at relay time and
   * cache it on the account. Gemini uses this to call loadCodeAssist
   * and store the `cloudaicompanionProject`.
   */
  fetchAccountMetadata?(accessToken: string): Promise<Record<string, unknown>>
}

const registry: Record<string, OAuthProvider> = {
  claude: {
    id: 'claude',
    mode: 'paste',
    generatePkce: claudeOauth.generatePkce,
    buildAuthorizeUrl: claudeOauth.buildAuthorizeUrl,
    exchangeCode: claudeOauth.exchangeCode,
    refreshToken: claudeOauth.refreshToken,
  },
  openai: {
    id: 'openai',
    mode: 'callback',
    generatePkce: openaiOauth.generatePkce,
    buildAuthorizeUrl: openaiOauth.buildAuthorizeUrl,
    exchangeCode: openaiOauth.exchangeCode,
    refreshToken: openaiOauth.refreshToken,
  },
  gemini: {
    id: 'gemini',
    mode: 'callback',
    generatePkce: geminiOauth.generatePkce,
    buildAuthorizeUrl: geminiOauth.buildAuthorizeUrl,
    exchangeCode: geminiOauth.exchangeCode,
    refreshToken: geminiOauth.refreshToken,
    fetchAccountMetadata: geminiOauth.fetchAccountMetadata,
  },
  grok: {
    id: 'grok',
    // xAI subscription via the grok-cli OAuth client. Redirects to a localhost
    // callback; on a remote server the admin pastes the full callback URL.
    mode: 'callback',
    generatePkce: grokOauth.generatePkce,
    buildAuthorizeUrl: grokOauth.buildAuthorizeUrl,
    exchangeCode: grokOauth.exchangeCode,
    refreshToken: grokOauth.refreshToken,
  },
  deepseek: {
    id: 'deepseek',
    // DeepSeek uses API keys — the OAuth methods below are never called.
    // Accounts are added via the import/token endpoint with expiresAt: 0.
    mode: 'paste' as const,
    generatePkce(): never { return notSupported('generatePkce') },
    buildAuthorizeUrl(): never { return notSupported('buildAuthorizeUrl') },
    async exchangeCode(): Promise<TokenSet> { return notSupported('exchangeCode') },
    async refreshToken(token: string): Promise<TokenSet> {
      // API keys don't expire — return unchanged.
      return { accessToken: token, refreshToken: '', expiresAt: 0 }
    },
  },
  xiaomi: {
    id: 'xiaomi',
    // Xiaomi MiMo uses API keys — same API-key flow as DeepSeek, no OAuth.
    // Accounts are added via the import/token endpoint with expiresAt: 0.
    mode: 'paste' as const,
    generatePkce(): never { return notSupported('generatePkce') },
    buildAuthorizeUrl(): never { return notSupported('buildAuthorizeUrl') },
    async exchangeCode(): Promise<TokenSet> { return notSupported('exchangeCode') },
    async refreshToken(token: string): Promise<TokenSet> {
      // API keys don't expire — return unchanged.
      return { accessToken: token, refreshToken: '', expiresAt: 0 }
    },
  },
  zhipu: {
    id: 'zhipu',
    // Zhipu GLM (BigModel) uses API keys — same API-key flow as DeepSeek, no OAuth.
    // Accounts are added via the import/token endpoint with expiresAt: 0.
    mode: 'paste' as const,
    generatePkce(): never { return notSupported('generatePkce') },
    buildAuthorizeUrl(): never { return notSupported('buildAuthorizeUrl') },
    async exchangeCode(): Promise<TokenSet> { return notSupported('exchangeCode') },
    async refreshToken(token: string): Promise<TokenSet> {
      // API keys don't expire — return unchanged.
      return { accessToken: token, refreshToken: '', expiresAt: 0 }
    },
  },
  qwen: {
    id: 'qwen',
    // Qwen (通义千问 / Alibaba DashScope) uses API keys — same API-key flow as
    // DeepSeek, no OAuth. Accounts are added via the import/token endpoint with
    // expiresAt: 0.
    mode: 'paste' as const,
    generatePkce(): never { return notSupported('generatePkce') },
    buildAuthorizeUrl(): never { return notSupported('buildAuthorizeUrl') },
    async exchangeCode(): Promise<TokenSet> { return notSupported('exchangeCode') },
    async refreshToken(token: string): Promise<TokenSet> {
      // API keys don't expire — return unchanged.
      return { accessToken: token, refreshToken: '', expiresAt: 0 }
    },
  },
  kimi: {
    id: 'kimi',
    // Kimi (月之暗面 / Moonshot) uses API keys — same API-key flow as DeepSeek,
    // no OAuth. Accounts are added via the import/token endpoint with
    // expiresAt: 0.
    mode: 'paste' as const,
    generatePkce(): never { return notSupported('generatePkce') },
    buildAuthorizeUrl(): never { return notSupported('buildAuthorizeUrl') },
    async exchangeCode(): Promise<TokenSet> { return notSupported('exchangeCode') },
    async refreshToken(token: string): Promise<TokenSet> {
      // API keys don't expire — return unchanged.
      return { accessToken: token, refreshToken: '', expiresAt: 0 }
    },
  },
  sub2api: {
    id: 'sub2api',
    // Sub2API is another relay upstream. Model-bridge stores its API key as an
    // access token and its Base URL on the account row; no OAuth refresh.
    mode: 'paste' as const,
    generatePkce(): never { return notSupported('generatePkce') },
    buildAuthorizeUrl(): never { return notSupported('buildAuthorizeUrl') },
    async exchangeCode(): Promise<TokenSet> { return notSupported('exchangeCode') },
    async refreshToken(token: string): Promise<TokenSet> {
      return { accessToken: token, refreshToken: '', expiresAt: 0 }
    },
  },
}

export function getProvider(id: string): OAuthProvider | undefined {
  return registry[id]
}

export function isSupportedProvider(id: string): boolean {
  return id in registry
}
