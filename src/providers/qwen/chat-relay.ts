import { mapModel } from './converter'

const QWEN_CHAT_COMPLETIONS_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

export function normalizeQwenChatCompletionsBody(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ...body,
    model: mapModel(body.model),
  }

  if (out.stream === true) {
    const streamOptions =
      out.stream_options && typeof out.stream_options === 'object'
        ? (out.stream_options as Record<string, unknown>)
        : {}
    out.stream_options = { ...streamOptions, include_usage: true }
  }

  return out
}

export function relayQwenChatCompletions(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const upstreamBody = normalizeQwenChatCompletionsBody(body)
  return fetch(QWEN_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: upstreamBody.stream === true ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify(upstreamBody),
  })
}
