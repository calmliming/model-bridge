const XIAOMI_MESSAGES_URL = 'https://api.xiaomimimo.com/anthropic/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

/** Relays a /v1/messages request to Xiaomi MiMo using its Anthropic-compatible endpoint. */
export function relayXiaomiMessages(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(XIAOMI_MESSAGES_URL, {
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
