import { fetchWithConnectTimeout } from '../../http/upstream'
import { googleErrorMessage } from '../google/errors'
import { createHash, randomBytes } from 'node:crypto'
import type { TokenSet } from '../types'
import { OAuthConfigurationError } from '../oauthErrors'

// ── Gemini CLI / Code Assist OAuth constants ──────────────────────
// The Gemini CLI ships with a public "installed app" client embedded
// in its binary (see packages/core/src/code_assist/oauth2.ts in
// google-gemini/gemini-cli). To keep those identifiers out of this
// repo, model-bridge reads them from the environment at startup.
function requireGeminiCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GEMINI_OAUTH_CLIENT_ID?.trim() ?? ''
  const clientSecret = process.env.GEMINI_OAUTH_CLIENT_SECRET?.trim() ?? ''
  if (!clientId || !clientSecret) {
    const missingVariables = [
      ...(!clientId ? ['GEMINI_OAUTH_CLIENT_ID'] : []),
      ...(!clientSecret ? ['GEMINI_OAUTH_CLIENT_SECRET'] : []),
    ]
    throw new OAuthConfigurationError(
      'gemini', missingVariables,
      `Gemini 上游授权缺少配置：${missingVariables.join('、')}。` +
        '请设置 Gemini CLI OAuth 客户端配置并重新启动服务；Docker 部署需将变量传入容器后重新创建容器。' +
        '网站登录的 GOOGLE_LOGIN_CLIENT_ID 不能替代这两项配置。',
    )
  }
  return { clientId, clientSecret }
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
  const credentials = requireGeminiCredentials()
  const params = new URLSearchParams({
    client_id: credentials.clientId,
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
  refresh_token?: string
  expires_in?: number
}

function toTokenSet(data: RawTokenResponse): TokenSet {
  if (typeof data.access_token !== 'string' || !data.access_token.trim()) throw new Error('Google token endpoint did not return an access token')
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? '',
    expiresAt: Date.now() + (typeof data.expires_in === 'number' && Number.isFinite(data.expires_in) && data.expires_in > 0 ? data.expires_in : 3600) * 1000,
  }
}

export async function exchangeCode(
  code: string,
  verifier: string,
  _state: string,
): Promise<TokenSet> {
  const credentials = requireGeminiCredentials()
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code.trim(),
    redirect_uri: REDIRECT_URI,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    code_verifier: verifier,
  })
  const res = await fetchWithConnectTimeout(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
    body: body.toString(),
  })
  if (!res.ok) {
    throw new Error(`token exchange failed (${res.status}): ${googleErrorMessage(res.status, await res.text())}`)
  }
  return toTokenSet((await res.json()) as RawTokenResponse)
}

export async function refreshToken(refreshTokenValue: string): Promise<TokenSet> {
  const credentials = requireGeminiCredentials()
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshTokenValue,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  })
  const res = await fetchWithConnectTimeout(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
    body: body.toString(),
  })
  if (!res.ok) {
    throw new Error(`token refresh failed (${res.status}): ${googleErrorMessage(res.status, await res.text())}`)
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
  const res = await fetchWithConnectTimeout(CODE_ASSIST_LOAD_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
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
    throw new Error(`loadCodeAssist failed (${res.status}): ${googleErrorMessage(res.status, await res.text())}`)
  }
  const data = (await res.json()) as {
    cloudaicompanionProject?: string | { id?: string }
    currentTier?: { id?: string }
    paidTier?: { id?: string }
    ineligibleTiers?: Array<{ reasonCode?: string; reasonMessage?: string }>
  }
  const project = typeof data.cloudaicompanionProject === 'string'
    ? data.cloudaicompanionProject.trim() : data.cloudaicompanionProject?.id?.trim()
  if (!project) {
    const reasons = data.ineligibleTiers?.map(tier => [tier.reasonCode, tier.reasonMessage].filter(Boolean).join(': ')).join('; ')
    if (reasons) throw new Error(googleErrorMessage(403, JSON.stringify({ error: { message: reasons } })))
    throw new Error('Gemini 未返回项目：请先在官方 Gemini CLI 完成账号开通，或检查该账号的 Code Assist 项目权限')
  }
  return {
    project,
    ...(typeof data.currentTier?.id === 'string' ? { googleCurrentTier: data.currentTier.id } : {}),
    ...(typeof data.paidTier?.id === 'string' ? { googlePaidTier: data.paidTier.id } : {}),
  }
}
