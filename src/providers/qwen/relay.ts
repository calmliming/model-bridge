const QWEN_MESSAGES_URL = 'https://dashscope.aliyuncs.com/apps/anthropic/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

/**
 * Relays a /v1/messages request to Qwen (通义千问) via Alibaba DashScope/Bailian's
 * Anthropic-compatible gateway (https://dashscope.aliyuncs.com/apps/anthropic).
 * DashScope authenticates with a Bearer API key (Claude Code's ANTHROPIC_AUTH_TOKEN);
 * `anthropic-version` is forwarded like the real Anthropic API expects.
 */
export function relayQwenMessages(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(QWEN_MESSAGES_URL, {
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
