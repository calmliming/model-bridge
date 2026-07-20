const KIMI_MESSAGES_URL = 'https://api.moonshot.cn/anthropic/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

/**
 * Relays a /v1/messages request to Kimi (月之暗面 / Moonshot) via its
 * Anthropic-compatible gateway (https://api.moonshot.cn/anthropic). Moonshot
 * authenticates with a Bearer API key (Claude Code's ANTHROPIC_AUTH_TOKEN);
 * `anthropic-version` is forwarded like the real Anthropic API expects.
 */
export function relayKimiMessages(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(KIMI_MESSAGES_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
      accept: body.stream === true ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify(body),
  })
}
