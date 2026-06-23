import { createHash, randomBytes } from 'node:crypto'
import type { TokenSet } from '../types'
import { extractOpenAIIdentity } from './identity'

// ── Codex CLI / ChatGPT OAuth constants ──────────────────────────
// Reverse-engineered from the official Codex CLI. The public client
// only accepts the localhost:1455 callback as a registered redirect URI.
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize'
const TOKEN_URL = 'https://auth.openai.com/oauth/token'
const REDIRECT_URI = 'http://localhost:1455/auth/callback'
// offline_access is what unlocks a refresh_token.
const SCOPES = 'openid profile email offline_access'

const USER_AGENT = 'codex_cli_rs/0.20.0'

function base64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface PkcePair {
  verifier: string
  challenge: string
}

export function generatePkce(): PkcePair {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/** Builds the auth.openai.com authorization URL the admin opens in a browser. */
export function buildAuthorizeUrl(state: string, challenge: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
  })
  return `${AUTHORIZE_URL}?${params.toString()}`
}

interface RawTokenResponse {
  access_token: string
  refresh_token: string
  expires_in?: number
  id_token?: string
}

function toTokenSet(data: RawTokenResponse): TokenSet {
  const identity = extractOpenAIIdentity(data.id_token)
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    // Persist the ChatGPT identity under `metadata.openai` so quota/reset can
    // address the right account without re-decoding tokens. Empty when the
    // id_token is absent (e.g. a refresh that doesn't re-issue one).
    ...(Object.keys(identity).length ? { metadata: { openai: identity } } : {}),
  }
}

/** Exchanges the code delivered to localhost:1455 for an access/refresh token pair. */
export async function exchangeCode(
  code: string,
  verifier: string,
  _state: string,
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code.trim(),
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': USER_AGENT,
      accept: 'application/json',
    },
    body: body.toString(),
  })
  if (!res.ok) {
    throw new Error(`token exchange failed (${res.status}): ${await res.text()}`)
  }
  return toTokenSet((await res.json()) as RawTokenResponse)
}

export async function refreshToken(refreshTokenValue: string): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshTokenValue,
    client_id: CLIENT_ID,
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': USER_AGENT,
      accept: 'application/json',
    },
    body: body.toString(),
  })
  if (!res.ok) {
    throw new Error(`token refresh failed (${res.status}): ${await res.text()}`)
  }
  return toTokenSet((await res.json()) as RawTokenResponse)
}
