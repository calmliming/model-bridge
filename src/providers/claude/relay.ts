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

const CACHE_CONTROL = { type: 'ephemeral' } as const

type SystemBlock = Record<string, unknown>

type TextBlock = {
  type: 'text'
  text: string
}

function hasIdentityPrefix(text: unknown): boolean {
  return typeof text === 'string' && text.startsWith(CLAUDE_CODE_IDENTITY)
}

/**
 * Anthropic silently rejects subscription OAuth tokens unless the system
 * prompt begins with the Claude Code identity block. Returns the system in
 * block-array form (so a cache breakpoint can be attached) with the identity
 * guaranteed first. Claude Code traffic already includes it.
 */
function normalizeSystem(system: unknown): SystemBlock[] {
  const identity: TextBlock = { type: 'text', text: CLAUDE_CODE_IDENTITY }
  if (system == null) return [identity]
  if (typeof system === 'string') {
    return hasIdentityPrefix(system)
      ? [{ type: 'text', text: system }]
      : [identity, { type: 'text', text: system }]
  }
  if (Array.isArray(system)) {
    const first = system[0] as { type?: string; text?: string } | undefined
    if (first?.type === 'text' && hasIdentityPrefix(first.text)) return system as SystemBlock[]
    return [identity, ...(system as SystemBlock[])]
  }
  return [identity]
}

/** True if any system block already carries a cache_control breakpoint. */
function systemHasCacheControl(system: SystemBlock[]): boolean {
  return system.some((block) => block != null && typeof block === 'object' && 'cache_control' in block)
}

/**
 * Attaches a cache breakpoint to the LAST system block. Render order is
 * tools → system → messages, so a breakpoint here caches tools+system together
 * — the stable prefix that repeats across requests and can be read back.
 * Relying on top-level auto cache_control instead places the only breakpoint on
 * the volatile last message, producing cache writes that are never read.
 */
function withSystemCacheBreakpoint(system: SystemBlock[]): SystemBlock[] {
  if (system.length === 0) return system
  const last = system[system.length - 1]
  return [...system.slice(0, -1), { ...last, cache_control: CACHE_CONTROL }]
}

/** Normalises an incoming Messages-API body to what Anthropic accepts. */
export function normalizeClaudeMessagesBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body }
  for (const field of FORBIDDEN_FIELDS) delete out[field]
  const system = normalizeSystem(body.system)
  // Cache the stable tools+system prefix so it can be READ across requests.
  // Skip when the client (e.g. real Claude Code) already manages its own
  // breakpoints, to avoid competing markers / exceeding the 4-breakpoint cap.
  out.system =
    body.cache_control || systemHasCacheControl(system) ? system : withSystemCacheBreakpoint(system)
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
