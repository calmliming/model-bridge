import { responsesToChatCompletions } from './converter'
import { fetchWithConnectTimeout } from '../../http/upstream'

const QWEN_CHAT_COMPLETIONS_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

/**
 * Relays a Responses-API request (from Codex CLI) to Qwen's DashScope OpenAI-compatible
 * chat/completions endpoint. The body is rewritten by `responsesToChatCompletions`;
 * the SSE response is then translated event-by-event back to Responses format
 * by the StreamTransform registered in routes/relay.ts.
 *
 * The upstream is always invoked with `stream: true` regardless of the client's
 * preference — the relay handler for this provider has `forceStream: true`, so
 * the response will always be streamed back to the client as well.
 */
export function relayQwenResponses(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const upstreamBody = responsesToChatCompletions({ ...body, stream: true })
  return fetchWithConnectTimeout(QWEN_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
    },
    body: JSON.stringify(upstreamBody),
  })
}
