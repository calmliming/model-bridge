import { fetchWithConnectTimeout } from '../../http/upstream'

const DEEPSEEK_MESSAGES_URL = 'https://api.deepseek.com/anthropic/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

/** Relays a /v1/messages request to DeepSeek using its Anthropic-compatible endpoint. */
export function relayDeepseekMessages(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetchWithConnectTimeout(DEEPSEEK_MESSAGES_URL, {
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
