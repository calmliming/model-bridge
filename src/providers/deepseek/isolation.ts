import { createHash } from 'node:crypto'

export type DeepseekRequestProtocol = 'messages' | 'chat.completions' | 'responses'

/** Creates a stable, opaque DeepSeek isolation id for one platform tenant. */
export function deepseekIsolationId(
  apiKeyId: string,
  ownerUserId: string | null | undefined,
  clientIdentity?: unknown,
): string {
  const tenant = ownerUserId || apiKeyId
  const client = typeof clientIdentity === 'string' ? clientIdentity.trim() : ''
  const digest = createHash('sha256')
    .update(`model-bridge:deepseek:${tenant}:${client}`)
    .digest('hex')
  return `mb_${digest.slice(0, 48)}`
}

/** Adds DeepSeek's provider-native user isolation field for each API dialect. */
export function withDeepseekUserIsolation(
  body: Record<string, unknown>,
  protocol: DeepseekRequestProtocol,
  apiKeyId: string,
  ownerUserId: string | null | undefined,
): Record<string, unknown> {
  const metadata = body.metadata
  const metadataUser =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>).user_id
      : undefined
  const clientIdentity =
    protocol === 'responses'
      ? body.user
      : protocol === 'chat.completions'
        ? body.user_id
        : metadataUser
  const isolationId = deepseekIsolationId(apiKeyId, ownerUserId, clientIdentity)

  if (protocol === 'responses') return { ...body, user: isolationId }
  if (protocol === 'chat.completions') return { ...body, user_id: isolationId }

  const nextMetadata: Record<string, unknown> =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {}
  nextMetadata.user_id = isolationId
  return { ...body, metadata: nextMetadata }
}
