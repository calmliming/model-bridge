import * as claudeOauth from './claude/oauth'
import type { TokenSet } from './types'

/** OAuth surface every provider exposes for account onboarding. */
export interface OAuthProvider {
  id: string
  generatePkce(): { verifier: string; challenge: string }
  buildAuthorizeUrl(state: string, challenge: string): string
  exchangeCode(code: string, verifier: string, state: string): Promise<TokenSet>
  refreshToken(refreshToken: string): Promise<TokenSet>
}

// Claude only for now; OpenAI and Gemini modules are added in Phase C/D.
const registry: Record<string, OAuthProvider> = {
  claude: {
    id: 'claude',
    generatePkce: claudeOauth.generatePkce,
    buildAuthorizeUrl: claudeOauth.buildAuthorizeUrl,
    exchangeCode: claudeOauth.exchangeCode,
    refreshToken: claudeOauth.refreshToken,
  },
}

export function getProvider(id: string): OAuthProvider | undefined {
  return registry[id]
}

export function isSupportedProvider(id: string): boolean {
  return id in registry
}
