import { setTimeout as delay } from 'node:timers/promises'
import { config } from '../../config'
import type { TokenSet } from '../types'
import { generatePkce } from '../gemini/oauth'
import { googleErrorMessage } from '../google/errors'
import { antigravityJson, fetchAntigravity, object } from './client'

export { generatePkce }
export const ANTIGRAVITY_REDIRECT_URI = 'http://localhost:8085/callback'

function credentials() {
  const secret = config.ANTIGRAVITY_OAUTH_CLIENT_SECRET
  if (!secret) throw Object.assign(new Error('请配置 ANTIGRAVITY_OAUTH_CLIENT_SECRET 后发起 Antigravity 授权'), { statusCode: 400 })
  return { client_id: config.ANTIGRAVITY_OAUTH_CLIENT_ID, client_secret: secret }
}

export function buildAuthorizeUrl(state: string, challenge: string): string {
  const { client_id } = credentials()
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id, redirect_uri: ANTIGRAVITY_REDIRECT_URI, response_type: 'code', state,
    access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256',
    scope: ['cloud-platform', 'userinfo.email', 'userinfo.profile', 'cclog', 'experimentsandconfigs']
      .map(scope => `https://www.googleapis.com/auth/${scope}`).join(' '),
  })}`
}

async function exchange(fields: Record<string, string>, oldRefreshToken = ''): Promise<TokenSet> {
  const response = await fetchAntigravity('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ ...credentials(), ...fields }).toString(), signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`token ${oldRefreshToken ? 'refresh' : 'exchange'} failed (${response.status}): ${googleErrorMessage(response.status, await response.text())}`)
  const data = object(await response.json())
  if (typeof data?.access_token !== 'string' || !data.access_token) throw new Error('Antigravity token endpoint returned no access token')
  const lifetime = typeof data.expires_in === 'number' && Number.isFinite(data.expires_in) && data.expires_in > 0 ? data.expires_in : 3600
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : oldRefreshToken,
    expiresAt: Date.now() + lifetime * 1000,
  }
}

export function exchangeCode(code: string, verifier: string, _state: string): Promise<TokenSet> {
  return exchange({ grant_type: 'authorization_code', code: code.trim(), code_verifier: verifier, redirect_uri: ANTIGRAVITY_REDIRECT_URI })
}

export function refreshToken(refresh_token: string): Promise<TokenSet> {
  return exchange({ grant_type: 'refresh_token', refresh_token }, refresh_token)
}

function projectOf(value: unknown): string | null {
  const id = typeof value === 'string' ? value : object(value)?.id
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

function tierOf(value: unknown): string | null {
  return projectOf(value)
}

/** Use only the tier returned by the service; never invent an entitlement or project. */
export async function fetchAccountMetadata(accessToken: string): Promise<Record<string, unknown>> {
  const data = await antigravityJson(accessToken, 'loadCodeAssist', {
    metadata: { ideType: 'ANTIGRAVITY', ideVersion: config.ANTIGRAVITY_USER_AGENT_VERSION, ideName: 'antigravity' },
  })
  let project = projectOf(data.cloudaicompanionProject)
  const currentTier = tierOf(data.currentTier)
  const paidTier = tierOf(data.paidTier)
  if (!project) {
    const tiers = Array.isArray(data.allowedTiers) ? data.allowedTiers.map(object).filter(tier => tier?.isDefault === true) : []
    const tierId = tierOf(tiers[0])
    if (!tierId) {
      const reasons = Array.isArray(data.ineligibleTiers) ? data.ineligibleTiers.map(object)
        .map(tier => [tier?.reasonCode, tier?.reasonMessage].filter(x => typeof x === 'string').join(': ')).join('; ') : ''
      throw new Error(reasons ? googleErrorMessage(403, JSON.stringify({ error: { message: reasons } }))
        : 'Antigravity 未返回项目或可用套餐；请先在官方应用完成账号开通并检查使用资格')
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await antigravityJson(accessToken, 'onboardUser', {
        tierId, metadata: { ideType: 'ANTIGRAVITY', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' },
      })
      if (result.done === true) {
        project = projectOf(object(result.response)?.cloudaicompanionProject)
        if (!project) throw new Error('Antigravity onboarding 完成但未返回项目')
        break
      }
      if (attempt < 4) await delay(1000)
    }
    if (!project) throw new Error('Antigravity 账号初始化尚未完成，请稍后重新授权')
  }
  return { project, ...(currentTier ? { googleCurrentTier: currentTier } : {}), ...(paidTier ? { googlePaidTier: paidTier } : {}) }
}
