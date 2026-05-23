import * as claudeOauth from './claude/oauth'
import * as openaiOauth from './openai/oauth'
import type { TokenSet } from './types'

/** OAuth surface every provider exposes for account onboarding. */
export interface OAuthProvider {
  id: string
  /**
   * How the dashboard finishes the OAuth flow:
   *   - 'paste'    — user pastes the code from the provider's display page (Claude).
   *   - 'callback' — provider redirects to localhost:1455 and the relay completes it (OpenAI).
   */
  mode: 'paste' | 'callback'
  generatePkce(): { verifier: string; challenge: string }
  buildAuthorizeUrl(state: string, challenge: string): string
  exchangeCode(code: string, verifier: string, state: string): Promise<TokenSet>
  refreshToken(refreshToken: string): Promise<TokenSet>
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
}

export function getProvider(id: string): OAuthProvider | undefined {
  return registry[id]
}

export function isSupportedProvider(id: string): boolean {
  return id in registry
}
