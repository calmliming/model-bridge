import { mapResponsesModel } from './converter'
import { withoutRelayReasoningItems } from '../chatResponsesStream'
import { fetchWithConnectTimeout } from '../../http/upstream'

const DEEPSEEK_RESPONSES_URL = 'https://api.deepseek.com/v1/responses'

function normalizeResponsesInputImages(input: unknown): unknown {
  if (!Array.isArray(input)) return input
  let changed = false
  const next = input.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    const row = item as Record<string, unknown>
    if (!Array.isArray(row.content)) return item
    let contentChanged = false
    const content = row.content.map((part) => {
      if (!part || typeof part !== 'object' || Array.isArray(part)) return part
      const p = part as Record<string, unknown>
      if (p.type !== 'input_image') return part
      const rawImageUrl = p.image_url
      const nestedUrl =
        rawImageUrl && typeof rawImageUrl === 'object' && !Array.isArray(rawImageUrl)
          ? (rawImageUrl as Record<string, unknown>).url
          : undefined
      const imageUrl =
        typeof rawImageUrl === 'string' && rawImageUrl
          ? rawImageUrl
          : typeof nestedUrl === 'string' && nestedUrl
            ? nestedUrl
            : typeof p.url === 'string' && p.url
              ? p.url
              : undefined
      if (imageUrl === undefined && !('url' in p)) return part
      if (p.image_url === imageUrl && !('url' in p)) return part
      contentChanged = true
      const { url: _url, ...rest } = p
      return imageUrl !== undefined ? { ...rest, image_url: imageUrl } : rest
    })
    if (!contentChanged) return item
    changed = true
    return { ...row, content }
  })
  return changed ? next : input
}

/**
 * Normalises a Responses request for DeepSeek's native Responses endpoint.
 * DeepSeek accepts V4.1 Flash and V4 Pro on this surface and supports streaming,
 * web_search, and custom function tools such as apply_patch directly.
 */
export function normalizeDeepseekResponsesBody(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body, model: mapResponsesModel(body.model), stream: body.stream === true }
  if (body.input !== undefined) out.input = normalizeResponsesInputImages(withoutRelayReasoningItems(body.input))
  return out
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
