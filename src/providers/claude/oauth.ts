import { createHash, randomBytes } from 'node:crypto'
import type { TokenSet } from '../types'

// ── Claude Code OAuth constants ──────────────────────────────────
// Reverse-engineered from the official Claude Code client. These are
// stable but undocumented — update here if Anthropic changes the flow.
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize'
// api.anthropic.com serves the same token endpoint as console.anthropic.com
// but without the Cloudflare managed challenge that blocks server-side calls.
const TOKEN_URL = 'https://api.anthropic.com/v1/oauth/token'
const REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback'
const SCOPES = 'org:create_api_key user:profile user:inference'

// Mimics the official Claude Code CLI so requests are not flagged as bot traffic.
const USER_AGENT = 'claude-cli/1.0.0 (external, cli)'

function base64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface PkcePair {
  verifier: string
  challenge: string
}

/** Generates a PKCE verifier/challenge pair (S256). */
export function generatePkce(): PkcePair {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/** Builds the claude.ai authorization URL the user opens in a browser. */
export function buildAuthorizeUrl(state: string, challenge: string): string {
  const params = new URLSearchParams({
    code: 'true',
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  })
  return `${AUTHORIZE_URL}?${params.toString()}`
}

interface RawTokenResponse {
  access_token: string
  refresh_token: string
  expires_in?: number
}

function toTokenSet(data: RawTokenResponse): TokenSet {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  }
}

/** Exchanges an authorization code (pasted by the user) for tokens. */
export async function exchangeCode(
  code: string,
  verifier: string,
  state: string,
): Promise<TokenSet> {
  // The pasted code sometimes arrives as "code#state".
  const rawCode = code.split('#')[0]?.trim() ?? code
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code: rawCode,
      state,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  })
  if (!res.ok) {
    throw new Error(`token exchange failed (${res.status}): ${await res.text()}`)
  }
  return toTokenSet((await res.json()) as RawTokenResponse)
}

/** Trades a refresh token for a fresh access token. */
export async function refreshToken(refreshTokenValue: string): Promise<TokenSet> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshTokenValue,
      client_id: CLIENT_ID,
    }),
  })
  if (!res.ok) {
    throw new Error(`token refresh failed (${res.status}): ${await res.text()}`)
  }
  return toTokenSet((await res.json()) as RawTokenResponse)
}
