const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'

// These mimic the official Claude Code client. Reverse-engineered and
// undocumented — update here if Anthropic changes the requirements.
const ANTHROPIC_VERSION = '2023-06-01'
const ANTHROPIC_BETA = 'oauth-2025-04-20'
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude."

interface TextBlock {
  type: 'text'
  text: string
}

function hasIdentityPrefix(text: unknown): boolean {
  return typeof text === 'string' && text.startsWith(CLAUDE_CODE_IDENTITY)
}

/**
 * Anthropic silently rejects subscription OAuth tokens unless the system
 * prompt begins with the Claude Code identity block. This guarantees it
 * for traffic from any client (Claude Code already includes it).
 */
function normalizeSystem(system: unknown): unknown {
  const identity: TextBlock = { type: 'text', text: CLAUDE_CODE_IDENTITY }
  if (system == null) return [identity]
  if (typeof system === 'string') {
    return hasIdentityPrefix(system) ? system : [identity, { type: 'text', text: system }]
  }
  if (Array.isArray(system)) {
    const first = system[0] as { type?: string; text?: string } | undefined
    if (first?.type === 'text' && hasIdentityPrefix(first.text)) return system
    return [identity, ...system]
  }
  return system
}

/** Relays a /v1/messages request to Anthropic using a subscription OAuth token. */
export function relayClaudeMessages(
  accessToken: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const payload = { ...body, system: normalizeSystem(body.system) }
  return fetch(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-beta': ANTHROPIC_BETA,
      'content-type': 'application/json',
      accept: body.stream === true ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify(payload),
  })
}
