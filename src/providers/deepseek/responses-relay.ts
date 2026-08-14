import { mapResponsesModel } from './converter'
import { fetchWithConnectTimeout } from '../../http/upstream'

const DEEPSEEK_RESPONSES_URL = 'https://api.deepseek.com/v1/responses'

/**
 * Normalises a Responses request for DeepSeek's native Responses endpoint.
 * DeepSeek accepts V4 Flash and V4 Pro on this surface and supports streaming,
 * web_search, and custom function tools such as apply_patch directly.
 */
export function normalizeDeepseekResponsesBody(
  body: Record<string, unknown>,
): Record<string, unknown> {
  return { ...body, model: mapResponsesModel(body.model), stream: body.stream === true }
}

/** Relays a Responses request to DeepSeek's native `/v1/responses` endpoint. */
export function relayDeepseekResponses(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const upstreamBody = normalizeDeepseekResponsesBody(body)
  return fetchWithConnectTimeout(DEEPSEEK_RESPONSES_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: upstreamBody.stream === true ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify(upstreamBody),
  })
}
