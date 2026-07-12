export interface GrokAccountMetadata {
  email?: string
}

/** Decodes a JWT payload segment without verifying the signature. */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const json = Buffer.from(parts[1]!, 'base64url').toString('utf8')
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * Extracts non-secret identity (currently just the account email) from an xAI
 * OAuth `id_token`. Returns an empty object when the token can't be decoded or
 * carries no email. Never logs or returns the raw token.
 */
export function extractGrokIdentity(idToken: string | undefined | null): GrokAccountMetadata {
  if (!idToken) return {}
  const payload = decodeJwtPayload(idToken)
  const email = payload?.email
  return typeof email === 'string' && email ? { email } : {}
}
