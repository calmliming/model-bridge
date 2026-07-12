import { createHash, randomBytes } from 'node:crypto'
import type { TokenSet } from '../types'
import {
  GROK_AUTHORIZE_URL,
  GROK_CLIENT_ID,
  GROK_OAUTH_USER_AGENT,
  GROK_REDIRECT_URI,
  GROK_SCOPE,
  GROK_TOKEN_URL,
} from './constants'
import { extractGrokIdentity } from './identity'

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

/** Builds the auth.x.ai authorization URL the admin opens in a browser. */
export function buildAuthorizeUrl(state: string, challenge: string): string {
  const params = new URLSearchParams({
    client_id: GROK_CLIENT_ID,
    response_type: 'code',
    redirect_uri: GROK_REDIRECT_URI,
    scope: GROK_SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    nonce: randomBytes(16).toString('hex'),
    plan: 'generic',
  })
  return `${GROK_AUTHORIZE_URL}?${params.toString()}`
}

interface RawTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  id_token?: string
}

function toTokenSet(data: RawTokenResponse, previousRefreshToken?: string): TokenSet {
  const identity = extractGrokIdentity(data.id_token)
  return {
    accessToken: data.access_token,
    // A refresh response may omit refresh_token — keep the previous one.
    refreshToken: data.refresh_token ?? previousRefreshToken ?? '',
    // xAI tokens default to a 6h lifetime when expires_in is absent.
    expiresAt: Date.now() + (data.expires_in ?? 6 * 3600) * 1000,
    ...(identity.email ? { metadata: { grok: identity } } : {}),
  }
}

/** Exchanges the authorization code (delivered to the localhost callback) for tokens. */
export async function exchangeCode(
  code: string,
  verifier: string,
  _state: string,
): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code.trim(),
    redirect_uri: GROK_REDIRECT_URI,
    client_id: GROK_CLIENT_ID,
    code_verifier: verifier,
  })
  const res = await fetch(GROK_TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': GROK_OAUTH_USER_AGENT,
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
    client_id: GROK_CLIENT_ID,
  })
  const res = await fetch(GROK_TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': GROK_OAUTH_USER_AGENT,
      accept: 'application/json',
    },
    body: body.toString(),
  })
  if (!res.ok) {
    throw new Error(`token refresh failed (${res.status}): ${await res.text()}`)
  }
  return toTokenSet((await res.json()) as RawTokenResponse, refreshTokenValue)
}
