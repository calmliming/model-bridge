import type { OpenAIAccountMetadata } from './types'

/** Decodes a JWT payload segment without verifying the signature. */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8')
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

interface OpenAIAuthClaims {
  chatgpt_account_id?: unknown
  chatgpt_user_id?: unknown
  chatgpt_plan_type?: unknown
  user_id?: unknown
  poid?: unknown
  organizations?: unknown
}

/** Picks the organization id: prefer `poid`, else the default/first organization entry. */
function resolveOrganizationId(auth: OpenAIAuthClaims): string | undefined {
  const poid = asString(auth.poid)
  if (poid) return poid
  if (!Array.isArray(auth.organizations)) return undefined
  const orgs = auth.organizations as Array<{ id?: unknown; is_default?: unknown }>
  const fromDefault = orgs.find((o) => o?.is_default === true)
  return asString(fromDefault?.id) ?? asString(orgs[0]?.id)
}

/**
 * Extracts non-secret ChatGPT account metadata from a Codex OAuth `id_token`.
 * OpenAI namespaces its claims under `https://api.openai.com/auth`. Returns an
 * empty object when the token can't be decoded or carries no useful claims.
 *
 * Never logs or returns the raw token — only the derived identity fields.
 */
export function extractOpenAIIdentity(idToken: string | undefined | null): OpenAIAccountMetadata {
  if (!idToken) return {}
  const payload = decodeJwtPayload(idToken)
  if (!payload) return {}
  const auth = (payload['https://api.openai.com/auth'] ?? {}) as OpenAIAuthClaims
  const identity: OpenAIAccountMetadata = {}
  const accountId = asString(auth.chatgpt_account_id)
  const userId = asString(auth.chatgpt_user_id) ?? asString(auth.user_id)
  const organizationId = resolveOrganizationId(auth)
  const email = asString(payload.email)
  const planType = asString(auth.chatgpt_plan_type)
  if (accountId) identity.chatgptAccountId = accountId
  if (userId) identity.chatgptUserId = userId
  if (organizationId) identity.organizationId = organizationId
  if (email) identity.email = email
  if (planType) identity.planType = planType
  return identity
}
