import { mapModel, responsesToChatCompletions } from './converter'
import { fetchWithConnectTimeout } from '../../http/upstream'

const KIMI_CHAT_COMPLETIONS_URL = 'https://api.moonshot.cn/v1/chat/completions'
const KIMI_RESPONSES_URL = 'https://api.moonshot.cn/v1/responses'

/** The native endpoint currently supports K3; K2 retains the chat adapter. */
export function supportsNativeKimiResponses(model: string): boolean {
  return mapModel(model).toLowerCase() === 'kimi-k3'
}

export function relayNativeKimiResponses(apiKey: string, body: Record<string, unknown>): Promise<Response> {
  return fetchWithConnectTimeout(KIMI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`, 'content-type': 'application/json',
      accept: body.stream === true ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify({ ...body, model: mapModel(body.model), stream: body.stream === true }),
  })
}

/**
 * Relays a Responses-API request (from Codex CLI) to Kimi's Moonshot OpenAI-compatible
 * chat/completions endpoint. The body is rewritten by `responsesToChatCompletions`;
 * the SSE response is then translated event-by-event back to Responses format
 * by the StreamTransform registered in routes/relay.ts.
 *
 * The upstream is always invoked with `stream: true` regardless of the client's
 * preference — the relay handler for this provider has `forceStream: true`, so
 * the response will always be streamed back to the client as well.
 */
export function relayKimiResponses(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const upstreamBody = responsesToChatCompletions({ ...body, stream: true })
  return fetchWithConnectTimeout(KIMI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
    },
    body: JSON.stringify(upstreamBody),
  })
}
