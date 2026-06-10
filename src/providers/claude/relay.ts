const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'

// These mimic the official Claude Code client. Reverse-engineered and
// undocumented — update here if Anthropic changes the requirements.
// 对齐 sub2api constants.go（截至 2026-06）的 FullClaudeCodeMimicryBetas。
const ANTHROPIC_VERSION = '2023-06-01'
const CLI_VERSION = '2.1.161'

// Beta flags — 顺序与真实 Claude Code CLI 抓包一致。
// Anthropic 基于完整 beta 集合判定请求来源；缺少任何官方 beta 会被降级到第三方额度。
const ANTHROPIC_BETAS = [
  'claude-code-20250219',
  'oauth-2025-04-20',
  'interleaved-thinking-2025-05-14',
  'prompt-caching-scope-2026-01-05',
  'effort-2025-11-24',
  'context-management-2025-06-27',
  'extended-cache-ttl-2025-04-11',
] as const
const ANTHROPIC_BETA = ANTHROPIC_BETAS.join(',')

const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude."
const USER_AGENT = `claude-cli/${CLI_VERSION} (external, cli)`
const FORBIDDEN_FIELDS = ['context_management'] as const

// X-Stainless-* headers — Claude Code SDK 自动附加的指纹，上游用于来源判定。
const STAINLESS_HEADERS: Record<string, string> = {
  'x-stainless-lang': 'js',
  'x-stainless-package-version': '0.94.0',
  'x-stainless-os': 'Linux',
  'x-stainless-arch': 'arm64',
  'x-stainless-runtime': 'node',
  'x-stainless-runtime-version': 'v24.3.0',
  'x-stainless-retry-count': '0',
  'x-stainless-timeout': '600',
  'x-app': 'cli',
  'anthropic-dangerous-direct-browser-access': 'true',
}

interface TextBlock {
  type: 'text'
  text: string
}

function hasIdentityPrefix(text: unknown): boolean {
  return typeof text === 'string' && text.startsWith(CLAUDE_CODE_IDENTITY)
}

/**
 * Anthropic silently rejects subscription OAuth tokens unless the system
 * prompt begins with the Claude Code identity block. This guarantees it
 * for traffic from any client (Claude Code already includes it).
 */
function normalizeSystem(system: unknown): unknown {
  const identity: TextBlock = { type: 'text', text: CLAUDE_CODE_IDENTITY }
  if (system == null) return [identity]
  if (typeof system === 'string') {
    return hasIdentityPrefix(system) ? system : [identity, { type: 'text', text: system }]
  }
  if (Array.isArray(system)) {
    const first = system[0] as { type?: string; text?: string } | undefined
    if (first?.type === 'text' && hasIdentityPrefix(first.text)) return system
    return [identity, ...system]
  }
  return system
}

/** Normalises an incoming Messages-API body to what Anthropic accepts. */
export function normalizeClaudeMessagesBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body }
  for (const field of FORBIDDEN_FIELDS) delete out[field]
  out.system = normalizeSystem(body.system)
  // 注入自动缓存：Anthropic 自动选择最优断点，无需手动放置 cache_control
  if (!out.cache_control) {
    out.cache_control = { type: 'ephemeral' }
  }
  return out
}

/** Relays a /v1/messages request to Anthropic using a subscription OAuth token. */
export function relayClaudeMessages(
  accessToken: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const payload = normalizeClaudeMessagesBody(body)
  return fetch(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-beta': ANTHROPIC_BETA,
      'content-type': 'application/json',
      'user-agent': USER_AGENT,
      accept: body.stream === true ? 'text/event-stream' : 'application/json',
      ...STAINLESS_HEADERS,
    },
    body: JSON.stringify(payload),
  })
}
