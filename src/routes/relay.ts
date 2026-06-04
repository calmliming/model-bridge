import type { ServerResponse } from 'node:http'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { requireApiKey } from '../middleware/apiKeyAuth'
import { ensureFreshToken, updateAccountQuota } from '../accounts/manager'
import { extractAccountQuota, quotaCooldownUntil } from '../accounts/quota'
import { disableAccount, markAccountUsed, penalizeAccount, pickAccount } from '../accounts/scheduler'
import { bindStickyAccount, clearStickyAccount, computeSessionKey } from '../accounts/session'
import { acquireSlot, checkRateLimit, releaseSlot } from '../middleware/limits'
import { isAllowedModel } from '../keys/modelAllowlist'
import { mapRequestedModel } from '../keys/modelMapping'
import { relayClaudeMessages } from '../providers/claude/relay'
import * as claudeUsage from '../providers/claude/usage'
import { relayOpenaiChatCompletions, relayOpenaiResponses } from '../providers/openai/relay'
import {
  buildResponsesErrorEvents,
  createChatCompletionStreamParser,
  createOpenaiChatCompletionsStreamTransform,
  parseChatCompletionUsage,
  responsesSseToChatCompletion,
} from '../providers/openai/chat'
import * as openaiUsage from '../providers/openai/usage'
import { relayGemini, unwrapResponseEnvelope } from '../providers/gemini/relay'
import * as geminiUsage from '../providers/gemini/usage'
import { relayDeepseekMessages } from '../providers/deepseek/relay'
import * as deepseekUsage from '../providers/deepseek/usage'
import { relayDeepseekChatCompletions } from '../providers/deepseek/chat-relay'
import { relayDeepseekResponses } from '../providers/deepseek/responses-relay'
import * as deepseekResponsesUsage from '../providers/deepseek/responses-usage'
import { createDeepseekResponsesStreamTransform } from '../providers/deepseek/stream'
import { mapModel as mapDeepseekResponsesModel } from '../providers/deepseek/converter'
import {
  isProviderAllowed,
  listGeminiModels,
  listOpenAIStyleModels,
} from '../providers/modelDiscovery'
import type { ProviderId } from '../providers/types'
import { recordUsage } from '../usage/recorder'
import { emptyUsage, type UsageData } from '../providers/types'

/** Max upstream accounts to try before giving up on a request. */
const MAX_ATTEMPTS = 3
const RATE_LIMIT_MARKERS = [
  'rate_limit',
  'rate limit',
  'rate-limit',
  'too many requests',
  'quota',
  'exceeded',
  'insufficient_quota',
  'resource_exhausted',
  'usage limit',
  'billing_hard_limit',
]

interface ParsedRoute {
  model: string
  /** Logical action — `messages` / `responses` / `generateContent` / `streamGenerateContent`. */
  action: string
}

interface UpstreamContext {
  model: string
  action: string
  account: { id: string; metadata: unknown }
}

interface StreamTransform {
  /** Translate one upstream SSE event into zero or more downstream events. */
  transform(data: unknown): unknown[]
  /** Emit closing / completion events once the upstream stream ends. */
  flush(): unknown[]
}

interface ProviderHandler {
  id: string
  /** Always stream the response regardless of the client's stream flag (Codex backend). */
  forceStream: boolean
  /**
   * Downstream speaks the OpenAI Responses-API SSE protocol (Codex backend).
   * The relay then guarantees the stream always ends with a terminal event
   * (`response.completed` / `response.failed`): on an upstream error it emits a
   * synthetic `response.failed` carrying the real error, and if the stream
   * drops before any terminal event it appends one. Without this, Codex sees
   * "stream closed before response.completed" and reconnects in a loop.
   */
  responsesProtocol?: boolean
  parseRoute(request: FastifyRequest, body: Record<string, unknown>): ParsedRoute
  normalizeModel?: (model: string) => string
  callUpstream(
    token: string,
    body: Record<string, unknown>,
    ctx: UpstreamContext,
  ): Promise<Response>
  createStreamParser(): { feed(event: unknown): void; result(): UsageData }
  parseJsonUsage(body: unknown): UsageData
  /**
   * Stream transforms usually parse usage from their downstream event shape.
   * Set this to `upstream` when the transformed output is only a compatibility
   * envelope and usage should be read from the original upstream event.
   */
  parseStreamEventsFrom?: 'upstream' | 'downstream'
  /** Optional converter for a streaming upstream that must become one JSON response. */
  bufferSseResponse?: (text: string, meta: RelayMeta) => { body: unknown; usage: UsageData }
  /** Optional payload transform applied to each SSE event / buffered JSON body. */
  transformEventData?: (data: unknown) => unknown
  /**
   * Optional stateful, one-chunk-to-many-events stream transform. Mutually
   * exclusive with `transformEventData` — providers should pick one. Used by
   * the DeepSeek Responses adapter to translate chat/completions chunks into
   * a Responses-API event sequence.
   */
  createStreamTransform?: () => StreamTransform
}

const PROVIDERS: Record<string, ProviderHandler> = {
  claude: {
    id: 'claude',
    forceStream: false,
    parseRoute: (_req, body) => ({
      model: typeof body.model === 'string' ? body.model : '',
      action: 'messages',
    }),
    callUpstream: (token, body, _ctx) => relayClaudeMessages(token, body),
    createStreamParser: claudeUsage.createStreamParser,
    parseJsonUsage: claudeUsage.parseJsonUsage,
  },
  openai: {
    id: 'openai',
    forceStream: true, // Codex backend itself rejects non-streaming.
    responsesProtocol: true,
    parseRoute: (_req, body) => ({
      model: typeof body.model === 'string' ? body.model : '',
      action: 'responses',
    }),
    callUpstream: (token, body, _ctx) => relayOpenaiResponses(token, body),
    createStreamParser: openaiUsage.createStreamParser,
    parseJsonUsage: openaiUsage.parseJsonUsage,
  },
  'openai-chat': {
    id: 'openai',
    forceStream: false,
    parseRoute: (_req, body) => ({
      model: typeof body.model === 'string' ? body.model : '',
      action: 'chat.completions',
    }),
    callUpstream: (token, body, _ctx) => relayOpenaiChatCompletions(token, body),
    createStreamParser: openaiUsage.createStreamParser,
    parseJsonUsage: parseChatCompletionUsage,
    parseStreamEventsFrom: 'upstream',
    bufferSseResponse: (text, meta) => responsesSseToChatCompletion(text, meta.model),
    createStreamTransform: createOpenaiChatCompletionsStreamTransform,
  },
  gemini: {
    id: 'gemini',
    forceStream: false,
    parseRoute: (req, _body) => {
      // URL form: /api/gemini/v1beta/models/{model}:{action}
      const wild = (req.params as { '*'?: string } | undefined)?.['*'] ?? ''
      const colon = wild.lastIndexOf(':')
      return colon >= 0
        ? { model: wild.slice(0, colon), action: wild.slice(colon + 1) }
        : { model: wild, action: 'generateContent' }
    },
    callUpstream: (token, body, ctx) => {
      const project = (ctx.account.metadata as { project?: string } | null)?.project
      if (!project) {
        throw new Error(
          'Gemini account has no project metadata — please re-add the account so the relay can call loadCodeAssist',
        )
      }
      return relayGemini(token, body, { model: ctx.model, action: ctx.action, project })
    },
    createStreamParser: geminiUsage.createStreamParser,
    parseJsonUsage: geminiUsage.parseJsonUsage,
    transformEventData: unwrapResponseEnvelope,
  },
  deepseek: {
    id: 'deepseek',
    forceStream: false,
    normalizeModel: mapDeepseekResponsesModel,
    parseRoute: (_req, body) => ({
      model: typeof body.model === 'string' ? body.model : '',
      action: 'messages',
    }),
    callUpstream: (token, body, _ctx) => relayDeepseekMessages(token, body),
    createStreamParser: deepseekUsage.createStreamParser,
    parseJsonUsage: deepseekUsage.parseJsonUsage,
  },
  'deepseek-chat': {
    id: 'deepseek',
    forceStream: false,
    normalizeModel: mapDeepseekResponsesModel,
    parseRoute: (_req, body) => ({
      model: typeof body.model === 'string' ? body.model : '',
      action: 'chat.completions',
    }),
    callUpstream: (token, body, _ctx) => relayDeepseekChatCompletions(token, body),
    createStreamParser: createChatCompletionStreamParser,
    parseJsonUsage: parseChatCompletionUsage,
  },
  // Route key only — provider.id stays 'deepseek' so account pool, allowed-
  // provider checks, and usage records all reuse the existing deepseek setup.
  // Backed by DeepSeek's OpenAI-compatible chat/completions endpoint with a
  // Responses-API ↔ Chat-Completions stream converter for Codex CLI.
  'deepseek-responses': {
    id: 'deepseek',
    forceStream: true,
    responsesProtocol: true,
    normalizeModel: mapDeepseekResponsesModel,
    parseRoute: (_req, body) => ({
      model: typeof body.model === 'string' ? body.model : '',
      action: 'responses',
    }),
    callUpstream: (token, body, _ctx) => relayDeepseekResponses(token, body),
    createStreamParser: deepseekResponsesUsage.createStreamParser,
    parseJsonUsage: deepseekResponsesUsage.parseJsonUsage,
    createStreamTransform: createDeepseekResponsesStreamTransform,
  },
}

interface RelayMeta {
  apiKeyId: string
  userId: string | null
  accountId: string
  provider: string
  model: string
  requestInput: string | null
  startedAt: number
}

interface UpstreamFailure {
  penalty: 'rate_limited' | 'error' | null
  retryable: boolean
  resetAt?: number | null
  /** When true the account token is permanently invalid — disable it instead of cooldown. */
  disable?: boolean
}

function textLooksRateLimited(text: string): boolean {
  const lower = text.toLowerCase()
  return RATE_LIMIT_MARKERS.some((marker) => lower.includes(marker))
}

async function readErrorText(response: Response): Promise<string> {
  try {
    return (await response.clone().text()).slice(0, 4_000)
  } catch {
    return ''
  }
}

function parseEpochMs(raw: string | null): number | null {
  if (!raw) return null
  const n = Number(raw.trim())
  if (!Number.isFinite(n) || n <= 0) return null
  return n > 10_000_000_000 ? Math.trunc(n) : Math.trunc(n * 1000)
}

function parseResetHeader(raw: string | null): number | null {
  if (!raw) return null
  const trimmed = raw.trim()
  const epoch = parseEpochMs(trimmed)
  if (epoch) return epoch
  const parsed = Date.parse(trimmed)
  return Number.isNaN(parsed) ? null : parsed
}

function parseRetryAfter(raw: string | null): number | null {
  if (!raw) return null
  const seconds = Number(raw.trim())
  if (Number.isFinite(seconds) && seconds >= 0) return Date.now() + seconds * 1000
  return parseResetHeader(raw)
}

function headerNumber(headers: Headers, name: string): number | null {
  const value = headers.get(name)
  if (!value) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function headerResetAfter(headers: Headers, name: string): number | null {
  const seconds = headerNumber(headers, name)
  return seconds == null || seconds < 0 ? null : Date.now() + seconds * 1000
}

function isAnthropicWindowExceeded(headers: Headers, window: '5h' | '7d'): boolean {
  const prefix = `anthropic-ratelimit-unified-${window}-`
  if (headers.get(`${prefix}surpassed-threshold`)?.toLowerCase() === 'true') return true
  const utilization = headerNumber(headers, `${prefix}utilization`)
  return utilization != null && utilization >= 1
}

function pickSooner(values: Array<number | null>): number | null {
  const valid = values.filter((v): v is number => !!v && v > Date.now())
  if (!valid.length) return null
  return Math.min(...valid)
}

function pickLater(values: Array<number | null>): number | null {
  const valid = values.filter((v): v is number => !!v && v > Date.now())
  if (!valid.length) return null
  return Math.max(...valid)
}

function parseAnthropicReset(headers: Headers): number | null {
  const reset5h = parseEpochMs(headers.get('anthropic-ratelimit-unified-5h-reset'))
  const reset7d = parseEpochMs(headers.get('anthropic-ratelimit-unified-7d-reset'))
  const fiveHourExceeded = isAnthropicWindowExceeded(headers, '5h')
  const sevenDayExceeded = isAnthropicWindowExceeded(headers, '7d')

  if (fiveHourExceeded && sevenDayExceeded) return pickLater([reset5h, reset7d])
  if (fiveHourExceeded) return reset5h
  if (sevenDayExceeded) return reset7d
  return pickSooner([
    reset5h,
    reset7d,
    parseEpochMs(headers.get('anthropic-ratelimit-unified-reset')),
  ])
}

function parseCodexReset(headers: Headers): number | null {
  const primaryUsed = headerNumber(headers, 'x-codex-primary-used-percent')
  const secondaryUsed = headerNumber(headers, 'x-codex-secondary-used-percent')
  const primaryReset = headerResetAfter(headers, 'x-codex-primary-reset-after-seconds')
  const secondaryReset = headerResetAfter(headers, 'x-codex-secondary-reset-after-seconds')

  const primaryExceeded = primaryUsed != null && primaryUsed >= 100
  const secondaryExceeded = secondaryUsed != null && secondaryUsed >= 100
  if (primaryExceeded && secondaryExceeded) return pickLater([primaryReset, secondaryReset])
  if (primaryExceeded) return primaryReset
  if (secondaryExceeded) return secondaryReset
  return pickLater([primaryReset, secondaryReset])
}

function parseDurationMs(raw: string): number | null {
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/i)
  if (!match) return null
  const value = Number(match[1])
  const unit = match[2]?.toLowerCase()
  if (!Number.isFinite(value)) return null
  if (unit === 'ms') return value
  if (unit === 's') return value * 1000
  if (unit === 'm') return value * 60_000
  if (unit === 'h') return value * 3_600_000
  return null
}

function nextLocalMidnightMs(): number {
  const next = new Date()
  next.setDate(next.getDate() + 1)
  next.setHours(0, 0, 0, 0)
  return next.getTime()
}

function parseBodyReset(text: string, provider: string): number | null {
  if (!text) return null
  try {
    const body = JSON.parse(text) as {
      error?: {
        message?: string
        resets_at?: number | string
        resets_in_seconds?: number | string
        details?: Array<{ metadata?: { quotaResetDelay?: string } }>
      }
    }
    const error = body.error
    const resetsAt = error?.resets_at
    if (typeof resetsAt === 'number') return parseEpochMs(String(resetsAt))
    if (typeof resetsAt === 'string') return parseEpochMs(resetsAt)

    const resetsInSeconds = Number(error?.resets_in_seconds)
    if (Number.isFinite(resetsInSeconds) && resetsInSeconds > 0) {
      return Date.now() + resetsInSeconds * 1000
    }

    for (const detail of error?.details ?? []) {
      const delay = detail.metadata?.quotaResetDelay
      if (!delay) continue
      const duration = parseDurationMs(delay)
      if (duration != null) return Date.now() + Math.ceil(duration)
    }

    const message = error?.message?.toLowerCase() ?? ''
    if (provider === 'gemini' && message.includes('per day')) return nextLocalMidnightMs()
  } catch {
    // Fall back to regex parsing below.
  }

  const retryIn = text.match(/retry in (\d+(?:\.\d+)?)s/i)
  if (retryIn?.[1]) return Date.now() + Number(retryIn[1]) * 1000
  return null
}

function parseRateLimitReset(provider: string, response: Response, text: string): number | null {
  return (
    parseCodexReset(response.headers) ??
    parseAnthropicReset(response.headers) ??
    parseRetryAfter(response.headers.get('retry-after')) ??
    parseResetHeader(response.headers.get('x-ratelimit-reset-requests')) ??
    parseResetHeader(response.headers.get('x-ratelimit-reset-tokens')) ??
    parseBodyReset(text, provider)
  )
}

function isTokenRevoked(text: string): boolean {
  try {
    const body = JSON.parse(text) as { error?: { code?: string } }
    return body.error?.code === 'token_revoked'
  } catch {
    return false
  }
}

async function classifyUpstreamFailure(
  provider: string,
  response: Response,
): Promise<UpstreamFailure> {
  if (response.status === 429) {
    const text = await readErrorText(response)
    return { penalty: 'rate_limited', retryable: true, resetAt: parseRateLimitReset(provider, response, text) }
  }
  if (response.status === 401) {
    const text = await readErrorText(response)
    if (isTokenRevoked(text)) {
      return { penalty: null, retryable: true, disable: true }
    }
    return { penalty: 'error', retryable: true }
  }
  if (response.status >= 500) {
    return { penalty: 'error', retryable: true }
  }
  if (response.status === 400 || response.status === 403) {
    const text = await readErrorText(response)
    if (textLooksRateLimited(text)) {
      return { penalty: 'rate_limited', retryable: true, resetAt: parseRateLimitReset(provider, response, text) }
    }
  }
  return { penalty: null, retryable: false }
}

/** Registers the provider relay endpoints. */
export function registerRelayRoutes(app: FastifyInstance): void {
  const claudeHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS.claude!)
  const openaiHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS.openai!)
  const openaiChatHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS['openai-chat']!)
  const geminiHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS.gemini!)
  const deepseekHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS.deepseek!)
  const deepseekChatHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS['deepseek-chat']!)
  const deepseekResponsesHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS['deepseek-responses']!)

  app.post('/api/claude/v1/messages', { preHandler: requireApiKey }, claudeHandler)
  app.post('/api/openai/v1/responses', { preHandler: requireApiKey }, openaiHandler)
  app.post('/api/openai/v1/chat/completions', { preHandler: requireApiKey }, openaiChatHandler)
  // Gemini API surface: /v1beta/models/{model}:{action}. The wildcard
  // captures `{model}:{action}` in a single segment.
  app.post('/api/gemini/v1beta/models/*', { preHandler: requireApiKey }, geminiHandler)
  // DeepSeek: Anthropic-compatible endpoint under /api/deepseek prefix.
  // Claude Code: ANTHROPIC_BASE_URL=https://your-host/api/deepseek
  app.post('/api/deepseek/v1/messages', { preHandler: requireApiKey }, deepseekHandler)
  // DeepSeek: OpenAI-compatible Chat Completions endpoint.
  // OpenAI clients: base URL=https://your-host/api/deepseek/v1
  app.post('/api/deepseek/v1/chat/completions', { preHandler: requireApiKey }, deepseekChatHandler)
  // DeepSeek: OpenAI Responses-API surface for Codex CLI. The relay rewrites
  // requests into chat/completions and translates the SSE stream back.
  // Codex: configure base_url=https://your-host/api/deepseek
  app.post('/api/deepseek/v1/responses', { preHandler: requireApiKey }, deepseekResponsesHandler)


  // ── Model discovery (GET /v1/models) ───────────────────
  app.get('/api/claude/v1/models', { preHandler: requireApiKey }, (request, reply) =>
    sendOpenAIStyleModelList(request, reply, 'claude'),
  )
  app.get('/api/openai/v1/models', { preHandler: requireApiKey }, (request, reply) =>
    sendOpenAIStyleModelList(request, reply, 'openai'),
  )
  app.get('/api/deepseek/v1/models', { preHandler: requireApiKey }, (request, reply) =>
    sendOpenAIStyleModelList(request, reply, 'deepseek'),
  )
  app.get('/api/gemini/v1beta/models', { preHandler: requireApiKey }, sendGeminiModelList)
  app.get('/api/gemini/v1beta/models/*', { preHandler: requireApiKey }, sendGeminiModel)

  app.get('/v1/models', { preHandler: requireApiKey }, (request, reply) =>
    sendOpenAIStyleModelList(request, reply),
  )
  app.get('/v1beta/models', { preHandler: requireApiKey }, sendGeminiModelList)
  app.get('/v1beta/models/*', { preHandler: requireApiKey }, sendGeminiModel)

  // Clean provider-native aliases for custom domains:
  // - OpenAI/Codex: base_url = https://api.example.com/v1
  // - Claude:       ANTHROPIC_BASE_URL = https://api.example.com
  // - Gemini:       base URL = https://api.example.com
  app.post('/v1/messages', { preHandler: requireApiKey }, claudeHandler)
  app.post('/v1/responses', { preHandler: requireApiKey }, openaiHandler)
  app.post('/v1/chat/completions', { preHandler: requireApiKey }, openaiChatHandler)
  app.post('/v1beta/models/*', { preHandler: requireApiKey }, geminiHandler)
}

function sendOpenAIStyleModelList(
  request: FastifyRequest,
  reply: FastifyReply,
  provider?: ProviderId,
): void {
  const apiKey = request.apiKey!
  if (provider && !isProviderAllowed(provider, apiKey)) {
    void reply.code(403).send({ error: `this API key may not use ${provider}` })
    return
  }
  void reply.send({
    object: 'list',
    data: listOpenAIStyleModels(apiKey, provider),
  })
}

function sendGeminiModelList(request: FastifyRequest, reply: FastifyReply): void {
  const apiKey = request.apiKey!
  if (!isProviderAllowed('gemini', apiKey)) {
    void reply.code(403).send({ error: 'this API key may not use gemini' })
    return
  }
  void reply.send({ models: listGeminiModels(apiKey) })
}

function sendGeminiModel(request: FastifyRequest, reply: FastifyReply): void {
  const apiKey = request.apiKey!
  if (!isProviderAllowed('gemini', apiKey)) {
    void reply.code(403).send({ error: 'this API key may not use gemini' })
    return
  }
  const modelName = (request.params as { '*'?: string } | undefined)?.['*'] ?? ''
  const normalized = modelName.startsWith('models/') ? modelName : `models/${modelName}`
  const model = listGeminiModels(apiKey).find((item) => item.name === normalized)
  if (!model) {
    void reply.code(404).send({ error: `model ${modelName || '(missing)'} not found` })
    return
  }
  void reply.send(model)
}

/**
 * Entry point: enforces per-key provider allow-list, rate limit and
 * concurrency gate, then runs the relay loop while holding a concurrency slot.
 */
async function executeRelay(
  request: FastifyRequest,
  reply: FastifyReply,
  provider: ProviderHandler,
): Promise<void> {
  const apiKey = request.apiKey!
  const body = (request.body ?? {}) as Record<string, unknown>
  const route = provider.parseRoute(request, body)
  const mappedModel = mapRequestedModel(route.model, apiKey.modelMappings)
  const parsed: ParsedRoute = {
    ...route,
    model: provider.normalizeModel ? provider.normalizeModel(mappedModel) : mappedModel,
  }

  if (apiKey.allowedProviders && !apiKey.allowedProviders.includes(provider.id)) {
    await reply.code(403).send({ error: `this API key may not use ${provider.id}` })
    return
  }
  if (!isAnyAllowedModel([route.model, mappedModel, parsed.model], apiKey.allowedModels)) {
    await reply.code(403).send({ error: `this API key may not use model ${parsed.model || '(missing)'}` })
    return
  }

  // Per-key request-rate limit (requests / minute).
  if (apiKey.rateLimit != null && !(await checkRateLimit(apiKey.id, apiKey.rateLimit))) {
    await reply.code(429).send({ error: 'rate limit exceeded for this API key' })
    return
  }

  // Per-key concurrency gate. Hold a slot for the whole request (including the
  // streamed body) and release it once the response is fully sent. Streaming
  // hijacks the reply, so onResponse hooks can't be relied on — release here.
  const concurrencyLimit = apiKey.concurrencyLimit
  if (concurrencyLimit != null && !(await acquireSlot(apiKey.id, concurrencyLimit))) {
    await reply.code(429).send({ error: 'too many concurrent requests for this API key' })
    return
  }
  try {
    await runRelayLoop(request, reply, provider, bodyWithMappedModel(body, parsed.model), parsed)
  } finally {
    if (concurrencyLimit != null) await releaseSlot(apiKey.id)
  }
}

function isAnyAllowedModel(models: string[], allowedModels: string[] | null | undefined): boolean {
  if (!allowedModels || allowedModels.length === 0) return true
  return [...new Set(models.map((model) => model.trim()).filter(Boolean))]
    .some((model) => isAllowedModel(model, allowedModels))
}

function bodyWithMappedModel(body: Record<string, unknown>, model: string): Record<string, unknown> {
  if (!model || typeof body.model !== 'string' || body.model === model) return body
  return { ...body, model }
}

/** Provider-generic relay loop: pick → call upstream → retry → stream/buffer. */
async function runRelayLoop(
  request: FastifyRequest,
  reply: FastifyReply,
  provider: ProviderHandler,
  body: Record<string, unknown>,
  parsed: ParsedRoute,
): Promise<void> {
  const apiKey = request.apiKey!
  const wantStream =
    provider.forceStream || body.stream === true || parsed.action === 'streamGenerateContent'
  const sessionKey = computeSessionKey(provider.id, apiKey.id, request.headers, body)
  const tried: string[] = []

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const account = await pickAccount(provider.id, tried, sessionKey, apiKey.accountGroupId ?? null)
    if (!account) {
      await reply.code(503).send({
        error: tried.length
          ? `all ${provider.id} accounts are unavailable`
          : `no ${provider.id} account configured`,
      })
      return
    }
    tried.push(account.id)

    let token: string
    try {
      token = await ensureFreshToken(account)
    } catch (err) {
      request.log.warn(`token refresh failed for ${account.id}: ${(err as Error).message}`)
      await penalizeAccount(account.id, 'error')
      continue
    }

    const startedAt = Date.now()
    let upstream: Response
    try {
      upstream = await provider.callUpstream(token, body, {
        model: parsed.model,
        action: parsed.action,
        account: { id: account.id, metadata: account.metadata },
      })
    } catch (err) {
      request.log.warn(`upstream call failed for ${account.id}: ${(err as Error).message}`)
      await penalizeAccount(account.id, 'error')
      continue
    }
    const quota = extractAccountQuota(provider.id, upstream.headers)
    if (quota) await updateAccountQuota(account.id, quota)

    const failure = await classifyUpstreamFailure(provider.id, upstream)
    const lastAttempt = attempt === MAX_ATTEMPTS - 1

    if (failure.retryable && !lastAttempt) {
      if (failure.disable) {
        await disableAccount(account.id)
        if (sessionKey) await clearStickyAccount(sessionKey)
      } else if (failure.penalty) {
        await penalizeAccount(account.id, failure.penalty, failure.resetAt)
      }
      await upstream.body?.cancel().catch(() => {})
      continue
    }

    if (failure.disable) {
      await disableAccount(account.id)
      if (sessionKey) await clearStickyAccount(sessionKey)
    } else if (failure.penalty) {
      await penalizeAccount(account.id, failure.penalty, failure.resetAt)
    } else if (upstream.ok) {
      const quotaCooldown = quotaCooldownUntil(quota)
      if (quotaCooldown) {
        await penalizeAccount(account.id, 'rate_limited', quotaCooldown)
      } else {
        await markAccountUsed(account.id)
        // Pin this conversation to the account so its prompt cache stays warm.
        if (sessionKey) await bindStickyAccount(sessionKey, account.id)
      }
    }

    const meta: RelayMeta = {
      apiKeyId: apiKey.id,
      userId: apiKey.userId,
      accountId: account.id,
      provider: provider.id,
      model: parsed.model,
      requestInput: summarizeRequestInput(body),
      startedAt,
    }
    if (wantStream) {
      await sendStreaming(reply, upstream, meta, provider)
    } else {
      await sendBuffered(reply, upstream, meta, provider)
    }
    return
  }

  await reply.code(503).send({ error: `all ${provider.id} accounts failed` })
}

/**
 * Streams an SSE response back. Three modes, selected per provider:
 *   - `createStreamTransform` (DeepSeek Responses): stateful transform that
 *     emits 0-N downstream events per upstream event, plus a flush at end.
 *   - `transformEventData` (Gemini): 1:1 payload rewrite per event.
 *   - neither: raw byte passthrough with side-channel usage parsing.
 */
async function sendStreaming(
  reply: FastifyReply,
  upstream: Response,
  meta: RelayMeta,
  provider: ProviderHandler,
): Promise<void> {
  reply.hijack()
  const raw = reply.raw
  const responsesProtocol = provider.responsesProtocol === true

  // Responses-protocol providers (Codex backend): an upstream error body is
  // usually JSON, not Responses SSE. Streaming it verbatim makes Codex reconnect
  // forever without ever showing the cause. Emit a synthetic `response.failed`
  // stream carrying the real error message instead.
  if (responsesProtocol && !upstream.ok) {
    const errorText = await upstream.text().catch(() => '')
    const { code, message } = extractUpstreamError(errorText, upstream.status)
    raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    for (const event of buildResponsesErrorEvents(message, code)) writeSseData(raw, event)
    raw.end()
    void recordUsage({
      apiKeyId: meta.apiKeyId,
      userId: meta.userId,
      accountId: meta.accountId,
      provider: meta.provider,
      model: meta.model,
      usage: emptyUsage(),
      status: 'error',
      latencyMs: Date.now() - meta.startedAt,
      requestInput: meta.requestInput,
    })
    return
  }

  const useStreamTransform = provider.createStreamTransform && upstream.ok
  raw.writeHead(upstream.status, {
    'content-type':
      responsesProtocol || useStreamTransform
        ? 'text/event-stream'
        : (upstream.headers.get('content-type') ?? 'text/event-stream'),
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })

  const parser = provider.createStreamParser()
  const transform = provider.transformEventData
  const streamTransform = useStreamTransform ? provider.createStreamTransform!() : null
  const parseUpstreamStream = provider.parseStreamEventsFrom === 'upstream'
  let buffer = ''
  let firstTokenMs: number | null = null
  const markFirstToken = () => {
    firstTokenMs ??= Date.now() - meta.startedAt
  }
  // For Responses-protocol providers, track whether a terminal event reached
  // the client so we can synthesize one if the stream drops early.
  let sawTerminal = false

  if (upstream.body) {
    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        if (streamTransform) {
          // Stateful multi-event transform: drain whole SSE blocks, feed
          // upstream JSON events to the transform, write each result as its
          // own `data:` line, and feed it to the usage parser.
          let sep: number
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            if (
              emitFromStreamTransform(
                raw,
                buffer.slice(0, sep),
                streamTransform,
                parser,
                parseUpstreamStream,
                markFirstToken,
              )
            ) {
              sawTerminal = true
            }
            buffer = buffer.slice(sep + 2)
          }
        } else if (transform) {
          // Event-buffered: only emit complete events, rewriting payloads.
          let sep: number
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            rewriteAndEmit(raw, buffer.slice(0, sep), transform, parser, markFirstToken)
            buffer = buffer.slice(sep + 2)
          }
        } else {
          // Raw passthrough; side-channel parse for usage.
          if (value.byteLength > 0) markFirstToken()
          raw.write(Buffer.from(value))
          let sep: number
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            if (feedSseBlock(buffer.slice(0, sep), parser)) sawTerminal = true
            buffer = buffer.slice(sep + 2)
          }
        }
      }
    } catch {
      // Client disconnected or upstream aborted — stop quietly.
    }
  }
  if (streamTransform) {
    for (const event of streamTransform.flush()) {
      if (!parseUpstreamStream && event !== '[DONE]') parser.feed(event)
      if (isResponsesTerminalEvent(event)) sawTerminal = true
      markFirstToken()
      writeSseData(raw, event)
    }
  }
  // Stream ended without a terminal event (upstream dropped mid-response) —
  // append one so Codex stops and reports it instead of reconnecting.
  if (responsesProtocol && !sawTerminal) {
    for (const event of buildResponsesErrorEvents(
      'Upstream stream closed before completion.',
      'upstream_stream_closed',
    )) {
      writeSseData(raw, event)
    }
  }
  raw.end()

  void recordUsage({
    apiKeyId: meta.apiKeyId,
    userId: meta.userId,
    accountId: meta.accountId,
    provider: meta.provider,
    model: meta.model,
    usage: parser.result(),
    status: upstream.ok && (!responsesProtocol || sawTerminal) ? 'success' : 'error',
    latencyMs: Date.now() - meta.startedAt,
    firstTokenMs,
    requestInput: meta.requestInput,
  })
}

const RESPONSES_TERMINAL_EVENTS = new Set([
  'response.completed',
  'response.failed',
  'response.incomplete',
])

/** True when a Responses-API SSE event is one of the stream-terminating types. */
function isResponsesTerminalEvent(event: unknown): boolean {
  if (!event || typeof event !== 'object') return false
  const type = (event as { type?: unknown }).type
  return typeof type === 'string' && RESPONSES_TERMINAL_EVENTS.has(type)
}

/** Extracts a displayable error code + message from an upstream error body. */
function extractUpstreamError(text: string, status: number): { code: string; message: string } {
  try {
    const body = JSON.parse(text) as {
      error?: { message?: unknown; code?: unknown; type?: unknown }
    }
    const message = body.error?.message
    if (typeof message === 'string' && message) {
      const code = body.error?.code ?? body.error?.type
      return { code: typeof code === 'string' && code ? code : `upstream_${status}`, message }
    }
  } catch {
    // Not JSON — fall back to the raw text below.
  }
  const trimmed = text.trim().slice(0, 500)
  return { code: `upstream_${status}`, message: trimmed || `Upstream returned HTTP ${status}.` }
}

/** Buffers a non-streaming response, optionally rewriting the JSON body, and records usage. */
async function sendBuffered(
  reply: FastifyReply,
  upstream: Response,
  meta: RelayMeta,
  provider: ProviderHandler,
): Promise<void> {
  const contentType = upstream.headers.get('content-type') ?? 'application/json'
  if (provider.bufferSseResponse && contentType.includes('text/event-stream')) {
    const sseText = await upstream.text()
    let responseText = sseText
    let usage: UsageData = emptyUsage()
    let responseContentType = contentType
    if (upstream.ok) {
      const converted = provider.bufferSseResponse(sseText, meta)
      responseText = JSON.stringify(converted.body)
      usage = converted.usage
      responseContentType = 'application/json'
    }
    void recordUsage({
      apiKeyId: meta.apiKeyId,
      userId: meta.userId,
      accountId: meta.accountId,
      provider: meta.provider,
      model: meta.model,
      usage,
      status: upstream.ok ? 'success' : 'error',
      latencyMs: Date.now() - meta.startedAt,
      requestInput: meta.requestInput,
    })
    await reply
      .code(upstream.status)
      .header('content-type', responseContentType)
      .send(responseText)
    return
  }

  let text = await upstream.text()
  let usage: UsageData = emptyUsage()
  try {
    let json = JSON.parse(text) as unknown
    if (provider.transformEventData) {
      json = provider.transformEventData(json)
      text = JSON.stringify(json)
    }
    usage = provider.parseJsonUsage(json)
  } catch {
    // Error responses aren't valid JSON — leave usage empty.
  }
  void recordUsage({
    apiKeyId: meta.apiKeyId,
    userId: meta.userId,
    accountId: meta.accountId,
    provider: meta.provider,
    model: meta.model,
    usage,
    status: upstream.ok ? 'success' : 'error',
    latencyMs: Date.now() - meta.startedAt,
    requestInput: meta.requestInput,
  })
  await reply
    .code(upstream.status)
    .header('content-type', contentType)
    .send(text)
}

function summarizeRequestInput(body: Record<string, unknown>): string | null {
  const sanitized = sanitizeRequestValue(body)
  const text = typeof sanitized === 'string' ? sanitized : JSON.stringify(sanitized, null, 2)
  if (!text || text === '{}') return null
  return text.length > 12_000 ? `${text.slice(0, 12_000)}\n...[truncated]` : text
}

function sanitizeRequestValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeRequestValue)
  if (!value || typeof value !== 'object') return value

  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase()
    if (
      lower.includes('token') ||
      lower.includes('secret') ||
      lower.includes('password') ||
      lower.includes('authorization') ||
      lower === 'key' ||
      lower === 'api_key'
    ) {
      out[key] = '[redacted]'
      continue
    }
    out[key] = sanitizeRequestValue(child)
  }
  return out
}

/**
 * Passthrough mode: parses each event for usage without rewriting. Returns
 * true if the block contained a Responses-API terminal event.
 */
function feedSseBlock(block: string, parser: { feed(event: unknown): void }): boolean {
  let sawTerminal = false
  for (const line of block.split('\n')) {
    const trimmed = line.trimStart()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      const parsed = JSON.parse(payload)
      parser.feed(parsed)
      if (isResponsesTerminalEvent(parsed)) sawTerminal = true
    } catch {
      // Ignore non-JSON data lines.
    }
  }
  return sawTerminal
}

/**
 * Stateful transform mode: parses each upstream `data:` JSON event, feeds it
 * to the stream transform, and writes each emitted event as its own SSE
 * frame. Non-data lines and `[DONE]` are dropped (the downstream protocol
 * has its own completion signal).
 */
function emitFromStreamTransform(
  raw: ServerResponse,
  block: string,
  xform: StreamTransform,
  parser: { feed(event: unknown): void },
  parseUpstream: boolean,
  onEmit?: () => void,
): boolean {
  let sawTerminal = false
  for (const line of block.split('\n')) {
    const trimmed = line.trimStart()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      continue
    }
    if (parseUpstream) parser.feed(parsed)
    for (const event of xform.transform(parsed)) {
      if (!parseUpstream && event !== '[DONE]') parser.feed(event)
      if (isResponsesTerminalEvent(event)) sawTerminal = true
      onEmit?.()
      writeSseData(raw, event)
    }
  }
  return sawTerminal
}

function writeSseData(raw: ServerResponse, event: unknown): void {
  if (event === '[DONE]') {
    raw.write('data: [DONE]\n\n')
    return
  }
  raw.write(`data: ${JSON.stringify(event)}\n\n`)
}

/** Transform mode: parses each event, applies transform, re-emits SSE. */
function rewriteAndEmit(
  raw: ServerResponse,
  block: string,
  transform: (data: unknown) => unknown,
  parser: { feed(event: unknown): void },
  onEmit?: () => void,
): void {
  const out: string[] = []
  for (const line of block.split('\n')) {
    const trimmed = line.trimStart()
    if (!trimmed.startsWith('data:')) {
      out.push(line) // event:, id:, retry:, … unchanged
      continue
    }
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') {
      out.push(line)
      continue
    }
    try {
      const parsed = JSON.parse(payload)
      const transformed = transform(parsed)
      parser.feed(transformed)
      out.push(`data: ${JSON.stringify(transformed)}`)
    } catch {
      out.push(line) // keep the original if we can't parse
    }
  }
  if (out.length > 0) onEmit?.()
  raw.write(out.join('\n') + '\n\n')
}
