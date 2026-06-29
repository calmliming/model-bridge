const ZHIPU_MESSAGES_URL = 'https://open.bigmodel.cn/api/anthropic/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

/**
 * Relays a /v1/messages request to Zhipu GLM using its Anthropic-compatible
 * endpoint (https://open.bigmodel.cn/api/anthropic). Zhipu's gateway accepts
 * the canonical Anthropic `x-api-key` header (the official cURL docs use it);
 * `anthropic-version` is forwarded like the real Anthropic API expects.
 */
export function relayZhipuMessages(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(ZHIPU_MESSAGES_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
      accept: body.stream === true ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify(body),
  })
}
