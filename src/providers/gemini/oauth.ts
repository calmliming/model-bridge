import { createHash, randomBytes } from 'node:crypto'
import type { TokenSet } from '../types'

// ── Gemini CLI / Code Assist OAuth constants ──────────────────────
// The Gemini CLI ships with a public "installed app" client embedded
// in its binary (see packages/core/src/code_assist/oauth2.ts in
// google-gemini/gemini-cli). To keep those identifiers out of this
// repo, model-bridge reads them from the environment at startup.
const CLIENT_ID = process.env.GEMINI_OAUTH_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.GEMINI_OAUTH_CLIENT_SECRET ?? ''
if (!CLIENT_ID || !CLIENT_SECRET) {
  throw new Error(
    'GEMINI_OAUTH_CLIENT_ID / GEMINI_OAUTH_CLIENT_SECRET must be set. ' +
      'See .env.example for where to obtain the Gemini CLI public client.',
  )
}
const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
// Google's installed-app flow allows any loopback port; we use the same
// 1455 listener as the OpenAI callback (different path).
const REDIRECT_URI = 'http://127.0.0.1:1455/oauth2callback'
const SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ')

const CODE_ASSIST_LOAD_URL = 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist'

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

/** Builds the accounts.google.com authorization URL the admin opens in a browser. */
export function buildAuthorizeUrl(state: string, challenge: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    // access_type=offline + prompt=consent are what Google requires to
    // return a refresh_token consistently.
    access_type: 'offline',
    prompt: 'consent',
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
    client_secret: CLIENT_SECRET,
    code_verifier: verifier,
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
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
    client_secret: CLIENT_SECRET,
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  })
  if (!res.ok) {
    throw new Error(`token refresh failed (${res.status}): ${await res.text()}`)
  }
  // Refresh responses don't always include a new refresh_token — reuse the old one.
  const data = (await res.json()) as RawTokenResponse
  if (!data.refresh_token) data.refresh_token = refreshTokenValue
  return toTokenSet(data)
}

/**
 * After OAuth, every cloudcode-pa request must include the user's
 * `cloudaicompanionProject` in the envelope. This call is how the
 * Gemini CLI discovers it; we cache the result on the account.
 */
export async function fetchAccountMetadata(
  accessToken: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(CODE_ASSIST_LOAD_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      cloudaicompanionProject: '',
      metadata: {
        ideType: 'IDE_UNSPECIFIED',
        platform: 'PLATFORM_UNSPECIFIED',
        pluginType: 'GEMINI',
      },
    }),
  })
  if (!res.ok) {
    throw new Error(`loadCodeAssist failed (${res.status}): ${await res.text()}`)
  }
  const data = (await res.json()) as { cloudaicompanionProject?: string }
  if (!data.cloudaicompanionProject) {
    throw new Error('loadCodeAssist did not return a cloudaicompanionProject')
  }
  return { project: data.cloudaicompanionProject }
}
