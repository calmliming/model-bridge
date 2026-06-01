import { describe, expect, it } from 'vitest'
import { buildAuthorizeUrl } from './oauth'

describe('OpenAI OAuth', () => {
  it('builds the Codex-compatible authorization URL', () => {
    const url = new URL(buildAuthorizeUrl('state-1', 'challenge-1'))

    expect(url.origin + url.pathname).toBe('https://auth.openai.com/oauth/authorize')
    expect(url.searchParams.get('state')).toBe('state-1')
    expect(url.searchParams.get('code_challenge')).toBe('challenge-1')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('id_token_add_organizations')).toBe('true')
    expect(url.searchParams.get('codex_cli_simplified_flow')).toBe('true')
  })
})
