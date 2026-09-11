import { fetchWithConnectTimeout } from '../../http/upstream'
import { assertSafeUpstreamUrl } from '../../http/urlGuard'

/** Accept either the platform root or its OpenAI / Anthropic SDK base URL. */
export function minimaxBaseUrl(baseUrl?: string | null): string {
  const url = assertSafeUpstreamUrl(baseUrl?.trim() || 'https://api.minimaxi.com')
  if (url.search || url.hash) throw new Error('MiniMax Base URL 不能包含查询参数或片段')
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/(?:anthropic(?:\/v1)?|v1)$/i, '')
  return url.toString().replace(/\/+$/, '')
}

export function mapMiniMaxModel(model: unknown): string {
  if (typeof model !== 'string' || !model.trim()) return 'MiniMax-M3'
  const value = model.trim()
  return /^minimax-/i.test(value) ? value.replace(/^minimax-m/i, 'MiniMax-M') : 'MiniMax-M3'
}

export function relayMiniMax(
  apiKey: string,
  body: Record<string, unknown>,
  protocol: 'messages' | 'chat' | 'responses',
  baseUrl?: string | null,
): Promise<Response> {
  const path = protocol === 'messages' ? '/anthropic/v1/messages'
    : protocol === 'chat' ? '/v1/chat/completions' : '/v1/responses'
  const input: Record<string, unknown> = { ...body, model: mapMiniMaxModel(body.model) }
  if (protocol === 'chat' && body.stream === true) {
    input.stream_options = { ...((body.stream_options ?? {}) as Record<string, unknown>), include_usage: true }
  }
  return fetchWithConnectTimeout(`${minimaxBaseUrl(baseUrl)}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: body.stream === true ? 'text/event-stream' : 'application/json',
      ...(protocol === 'messages' ? { 'anthropic-version': '2023-06-01' } : {}),
    },
    body: JSON.stringify(input),
  })
}

export async function testMiniMax(apiKey: string, baseUrl?: string | null): Promise<void> {
  const response = await fetchWithConnectTimeout(`${minimaxBaseUrl(baseUrl)}/v1/models`, {
    headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`MiniMax 模型查询失败（HTTP ${response.status}）`)
  const body = await response.json() as { data?: unknown }
  if (!Array.isArray(body.data)) throw new Error('MiniMax 模型查询返回格式无效')
}
