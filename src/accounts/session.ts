import { createHash } from 'node:crypto'
import { getRedis } from '../store/redis'

/**
 * 粘性会话：让同一对话的所有轮次都落在同一个上游账户上。否则 LRU 调度器会把
 * 一个对话分散到多个账户——这会浪费 Anthropic 的 prompt 缓存写入（下一个账户
 * 没有缓存，每一轮都要重新支付昂贵的 cache_write），并且在上游限流器看来像是
 * 账户共享。
 *
 * 绑定后端可插拔，两种方式都带滑动 TTL：
 *   - 未配置 REDIS_URL → 进程内 Map（单节点）。
 *   - 配置了 REDIS_URL → 共享的 Redis 键，这样即使请求落到不同副本上，
 *     对话也始终钉在同一个账户。
 *
 * 如果绑定的账户变得不可用，调度器会退回 LRU，下一次成功选择会覆盖该绑定，
 * 因此能自愈。
 */

/** How long a session stays bound to an account after its last request. */
const STICKY_TTL_MS = 30 * 60_000
/** Sweep expired bindings once the map grows past this many entries. */
const SWEEP_THRESHOLD = 10_000

interface StickyBinding {
  accountId: string
  expiresAt: number
}

const bindings = new Map<string, StickyBinding>()
const stickyKey = (sessionKey: string) => `mb:sticky:${sessionKey}`

function sweepExpired(now: number): void {
  for (const [key, binding] of bindings) {
    if (binding.expiresAt <= now) bindings.delete(key)
  }
}

/** Returns the account currently bound to this session, or null if none / expired. */
export async function getStickyAccountId(
  sessionKey: string,
  now = Date.now(),
): Promise<string | null> {
  const redis = getRedis()
  if (redis) {
    try {
      return await redis.get(stickyKey(sessionKey))
    } catch {
      return null // fail open：放弃粘性，退回 LRU
    }
  }
  const binding = bindings.get(sessionKey)
  if (!binding) return null
  if (binding.expiresAt <= now) {
    bindings.delete(sessionKey)
    return null
  }
  return binding.accountId
}

/** Binds a session to an account (or refreshes the TTL of an existing binding). */
export async function bindStickyAccount(
  sessionKey: string,
  accountId: string,
  now = Date.now(),
): Promise<void> {
  const redis = getRedis()
  if (redis) {
    try {
      await redis.set(stickyKey(sessionKey), accountId, 'PX', STICKY_TTL_MS)
    } catch {
      // 忽略：丢一次绑定只是少了一次缓存预热的机会
    }
    return
  }
  if (bindings.size >= SWEEP_THRESHOLD) sweepExpired(now)
  bindings.set(sessionKey, { accountId, expiresAt: now + STICKY_TTL_MS })
}

/** Drops a session binding (e.g. when its account was disabled). */
export async function clearStickyAccount(sessionKey: string): Promise<void> {
  const redis = getRedis()
  if (redis) {
    try {
      await redis.del(stickyKey(sessionKey))
    } catch {
      // 忽略
    }
    return
  }
  bindings.delete(sessionKey)
}

/** Test/maintenance helper: clears every in-memory binding. */
export async function resetStickyBindings(): Promise<void> {
  bindings.clear()
}

// ── Session fingerprinting ─────────────────────────────────────────────────

/** Request headers a client may use to pin a conversation explicitly. */
// Codex has emitted both hyphenated and underscored spellings over time. Keep
// the hyphenated form first so the current official client signal wins when a
// proxy happens to forward both variants.
const SESSION_HEADERS = ['session-id', 'session_id', 'conversation_id', 'x-session-id', 'x-conversation-id']

type Headers = Record<string, string | string[] | undefined>

export type SessionSource = 'header' | 'prompt_cache_key' | 'metadata' | 'grok_header' | 'content_fingerprint'

export interface SessionInfo {
  key: string
  source: SessionSource
  /** Short, non-sensitive hash of the full scoped key for diagnostics. */
  hash: string
}

function headerValue(headers: Headers, name: string): string | null {
  const direct = headers[name] ?? headers[name.toLowerCase()]
  const value = Array.isArray(direct) ? direct[0] : direct
  if (typeof value === 'string' && value.trim()) return value.trim()

  const wanted = name.toLowerCase()
  for (const [key, raw] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue
    const candidate = Array.isArray(raw) ? raw[0] : raw
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return null
}

function headerSessionId(headers: Headers): string | null {
  for (const name of SESSION_HEADERS) {
    const value = headerValue(headers, name)
    if (value) return value
  }
  return null
}

function bodyPromptCacheKey(body: Record<string, unknown>): string | null {
  const raw = body.prompt_cache_key
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null
}

/** Extracts a Grok/Codex session id nested in metadata.user_id when present. */
function bodyMetadataSessionKey(body: Record<string, unknown>): string | null {
  const metadata = body.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const row = metadata as Record<string, unknown>
  const direct = [row.session_id, row.sessionId, row.conversation_id, row.conversationId]
  for (const candidate of direct) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  const nested = row.user_id
  if (typeof nested !== 'string' || !nested.trim()) return null
  try {
    const parsed = JSON.parse(nested) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const object = parsed as Record<string, unknown>
    for (const key of ['session_id', 'sessionId', 'conversation_id', 'conversationId']) {
      const candidate = object[key]
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
    }
  } catch {
    // metadata.user_id is commonly an opaque user identifier; do not use it
    // as a conversation key unless it contains a structured session field.
  }
  return null
}

function grokConversationHeader(headers: Headers): string | null {
  return headerValue(headers, 'x-grok-conv-id') ?? headerValue(headers, 'grok-conv-id')
}

/**
 * Flattens the many shapes of "message content" across providers into plain
 * text: a bare string, an array of content blocks ({text} / {type,text}),
 * or a Gemini-style {parts:[{text}]} object.
 */
function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => textFromContent(part)).join('')
  }
  if (content && typeof content === 'object') {
    const obj = content as { text?: unknown; parts?: unknown; content?: unknown }
    if (typeof obj.text === 'string') return obj.text
    if (Array.isArray(obj.parts)) return textFromContent(obj.parts)
    if (obj.content !== undefined) return textFromContent(obj.content)
  }
  return ''
}

function normalizeSeedValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  return JSON.stringify(stableJsonValue(value))
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, stableJsonValue(child)]),
  )
}

function pushIfSeed(parts: string[], name: string, value: unknown): void {
  if (value === undefined || value === null) return
  if (Array.isArray(value) && value.length === 0) return
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return
  const normalized = normalizeSeedValue(value)
  if (normalized) parts.push(`${name}=${normalized}`)
}

/** Extracts the system / instruction prompt across Anthropic, OpenAI and Gemini shapes. */
function extractSystemText(body: Record<string, unknown>): string {
  const parts = [
    textFromContent(body.system), // Anthropic messages
    textFromContent(body.instructions), // OpenAI Responses
    textFromContent(body.systemInstruction), // Gemini (camelCase)
    textFromContent(body.system_instruction), // Gemini (snake_case)
  ]

  const messages = body.messages
  if (Array.isArray(messages)) {
    for (const message of messages) {
      const role = (message as { role?: unknown })?.role
      if (role === 'system' || role === 'developer') {
        parts.push(textFromContent((message as { content?: unknown })?.content))
      }
    }
  }

  const input = body.input
  if (Array.isArray(input)) {
    for (const item of input) {
      const role = (item as { role?: unknown })?.role
      if (role === 'system' || role === 'developer') {
        parts.push(textFromContent((item as { content?: unknown })?.content ?? item))
      }
    }
  }

  return parts.map((part) => part.trim()).filter(Boolean).join('\u0000')
}

/** Extracts the first user turn — the stable prefix shared by every turn of a conversation. */
function extractFirstTurnText(body: Record<string, unknown>): string {
  // Anthropic / chat completions: messages[]
  const messages = body.messages
  if (Array.isArray(messages) && messages.length) {
    const first =
      messages.find((m) => (m as { role?: string })?.role === 'user') ?? messages[0]
    return textFromContent((first as { content?: unknown })?.content)
  }
  // OpenAI / DeepSeek Responses: input is a string or an array of items
  const input = body.input
  if (typeof input === 'string') return input
  if (Array.isArray(input) && input.length) {
    const first =
      input.find((item) => (item as { role?: string })?.role === 'user') ??
      input.find((item) => (item as { type?: string })?.type === 'input_text') ??
      input[0]
    return textFromContent(first)
  }
  // Gemini: contents[] with role 'user' | 'model'
  const contents = body.contents
  if (Array.isArray(contents) && contents.length) {
    const first =
      contents.find((c) => (c as { role?: string })?.role !== 'model') ?? contents[0]
    return textFromContent((first as { parts?: unknown })?.parts ?? first)
  }
  return ''
}

function contentSeed(body: Record<string, unknown>): string | null {
  const system = extractSystemText(body)
  const first = extractFirstTurnText(body)
  if (!system && !first) return null

  const parts: string[] = []
  pushIfSeed(parts, 'model', body.model)
  pushIfSeed(parts, 'tools', body.tools)
  pushIfSeed(parts, 'functions', body.functions)
  pushIfSeed(parts, 'tool_choice', body.tool_choice)
  pushIfSeed(parts, 'reasoning', body.reasoning)
  pushIfSeed(parts, 'reasoning_effort', body.reasoning_effort)
  pushIfSeed(parts, 'system', system)
  pushIfSeed(parts, 'first_user', first)
  return parts.join('\u0000')
}

export function hashSessionKey(sessionKey: string): string {
  return createHash('sha256').update(sessionKey).digest('hex').slice(0, 16)
}

/**
 * Computes sticky-session information for a request, scoped to provider + API
 * key. Explicit session headers win; OpenAI-compatible body cache keys follow.
 * Grok additionally accepts the structured metadata session and its transient
 * conversation header before falling back to a stable content fingerprint.
 *
 * Returns null when no useful session signal can be derived, in which case the
 * caller should fall back to plain LRU scheduling (no stickiness).
 */
export function computeSessionInfo(
  provider: string,
  apiKeyId: string,
  headers: Headers,
  body: Record<string, unknown>,
): SessionInfo | null {
  const explicit = headerSessionId(headers)
  if (explicit) {
    const key = `${provider}:${apiKeyId}:h:${explicit}`
    return { key, source: 'header', hash: hashSessionKey(key) }
  }

  const promptCacheKey = bodyPromptCacheKey(body)
  if (promptCacheKey) {
    const key = `${provider}:${apiKeyId}:p:${promptCacheKey}`
    return { key, source: 'prompt_cache_key', hash: hashSessionKey(key) }
  }

  // Grok side calls may carry the stable parent session in metadata.user_id
  // while assigning a fresh X-Grok-Conv-Id to each call. Metadata must win over
  // that transient header, and it is safe to strip before the upstream request.
  if (provider === 'grok') {
    const metadataSession = bodyMetadataSessionKey(body)
    if (metadataSession) {
      const key = `${provider}:${apiKeyId}:m:${metadataSession}`
      return { key, source: 'metadata', hash: hashSessionKey(key) }
    }
    const grokHeader = grokConversationHeader(headers)
    if (grokHeader) {
      const key = `${provider}:${apiKeyId}:gh:${grokHeader}`
      return { key, source: 'grok_header', hash: hashSessionKey(key) }
    }
  }

  const seed = contentSeed(body)
  if (!seed) return null

  const fingerprint = createHash('sha256')
    .update(seed)
    .digest('hex')
    .slice(0, 16)
  const key = `${provider}:${apiKeyId}:f:${fingerprint}`
  return { key, source: 'content_fingerprint', hash: hashSessionKey(key) }
}

export function computeSessionKey(
  provider: string,
  apiKeyId: string,
  headers: Headers,
  body: Record<string, unknown>,
): string | null {
  return computeSessionInfo(provider, apiKeyId, headers, body)?.key ?? null
}
