import type { ServerResponse } from 'node:http'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { config } from '../config'
import { requireApiKey } from '../middleware/apiKeyAuth'
import { accountConcurrencyKey, ensureFreshToken, updateAccountQuota } from '../accounts/manager'
import { PermanentRefreshError } from '../accounts/refreshErrors'
import { extractAccountQuota, quotaPauseUntil, resolveAutopausePercent } from '../accounts/quota'
import { getQuotaAutopausePercent } from '../db/settings'
import {
  disableAccount,
  markAccountUsed,
  penalizeAccount,
  penalizeAccountModel,
  pickAccount,
} from '../accounts/scheduler'
import {
  bindStickyAccount,
  clearStickyAccount,
  computeSessionInfo,
  getStickyAccountId,
} from '../accounts/session'
import { acquireSlot, checkRateLimit, releaseSlot } from '../middleware/limits'
import { isAllowedModel } from '../keys/modelAllowlist'
import { mapRequestedModel } from '../keys/modelMapping'
import { relayClaudeChatCompletions, relayClaudeMessages } from '../providers/claude/relay'
import * as claudeUsage from '../providers/claude/usage'
import {
  claudeSseToChatCompletion,
  createClaudeChatCompletionsStreamTransform,
} from '../providers/claude/chat'
import { relayOpenaiChatCompletions, relayOpenaiResponses } from '../providers/openai/relay'
import {
  convertOpenAIImagesSse,
  createOpenAIImagesStreamTransform,
  createOpenAIImagesUsageParser,
  parseOpenAIImagesRequest,
  relayOpenaiImages,
  summarizeOpenAIImagesRequest,
  validateOpenAIImagesRequestModel,
  type OpenAIImagesEndpoint,
  type OpenAIImagesRequestBody,
} from '../providers/openai/images'
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
import { mapModel as mapDeepseekModel, mapResponsesModel as mapDeepseekResponsesModel } from '../providers/deepseek/converter'
import { withDeepseekUserIsolation } from '../providers/deepseek/isolation'
import { relayXiaomiMessages } from '../providers/xiaomi/relay'
import * as xiaomiUsage from '../providers/xiaomi/usage'
import { relayXiaomiChatCompletions } from '../providers/xiaomi/chat-relay'
import { relayXiaomiResponses } from '../providers/xiaomi/responses-relay'
import * as xiaomiResponsesUsage from '../providers/xiaomi/responses-usage'
import { createXiaomiResponsesStreamTransform } from '../providers/xiaomi/stream'
import { mapModel as mapXiaomiResponsesModel } from '../providers/xiaomi/converter'
import { relayZhipuMessages } from '../providers/zhipu/relay'
import * as zhipuUsage from '../providers/zhipu/usage'
import { relayZhipuChatCompletions } from '../providers/zhipu/chat-relay'
import { relayZhipuResponses } from '../providers/zhipu/responses-relay'
import * as zhipuResponsesUsage from '../providers/zhipu/responses-usage'
import { createZhipuResponsesStreamTransform } from '../providers/zhipu/stream'
import { mapModel as mapZhipuResponsesModel } from '../providers/zhipu/converter'
import { relayQwenMessages } from '../providers/qwen/relay'
import * as qwenUsage from '../providers/qwen/usage'
import { relayQwenChatCompletions } from '../providers/qwen/chat-relay'
import { relayQwenResponses } from '../providers/qwen/responses-relay'
import * as qwenResponsesUsage from '../providers/qwen/responses-usage'
import { createQwenResponsesStreamTransform } from '../providers/qwen/stream'
import { mapModel as mapQwenResponsesModel } from '../providers/qwen/converter'
import { relayKimiMessages } from '../providers/kimi/relay'
import * as kimiUsage from '../providers/kimi/usage'
import { relayKimiChatCompletions } from '../providers/kimi/chat-relay'
import { relayKimiResponses } from '../providers/kimi/responses-relay'
import * as kimiResponsesUsage from '../providers/kimi/responses-usage'
import { createKimiResponsesStreamTransform } from '../providers/kimi/stream'
import { mapModel as mapKimiResponsesModel } from '../providers/kimi/converter'
import {
  relaySub2ApiChatCompletions,
  relaySub2ApiMessages,
  relaySub2ApiResponses,
} from '../providers/sub2api/relay'
import { mapGrokModel, relayGrokChatCompletions, relayGrokResponses } from '../providers/grok/relay'
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

// Relay-to-relay upstreams (sub2api) rotate their own backend pool, so a
// transient failure isn't tied to our key. When retries are exhausted we apply
// only this brief back-off instead of the multi-minute OAuth cooldown, so a
// single in-group sub2api account doesn't blank the pool for minutes.
const RELAY_TO_RELAY_COOLDOWN_MS = 3_000
const STICKY_SLOT_POLL_MS = 250
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
  account: { id: string; metadata: unknown; proxyUrl: string | null }
}

interface PrepareBodyContext {
  apiKeyId: string
  userId: string | null
  action: string
}

interface StreamTransform {
  /** Translate one upstream SSE event into zero or more downstream events. */
  transform(data: unknown): unknown[]
  /** Emit closing / completion events once the upstream stream ends. */
  flush(): unknown[]
  /** Final transformed-stream status, when success cannot be inferred from HTTP. */
  status?(): 'success' | 'error'
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
  /**
   * Upstream is itself another relay/gateway (sub2api) rather than a single
   * OAuth/API-key credential. Such a gateway rotates its own backend pool, so a
   * transient 429/5xx from it is not tied to our specific key. The relay loop
   * therefore retries the SAME account on a transient failure (instead of
   * blackballing it) and, when it finally gives up, applies only a short
   * cooldown — so a single in-group account doesn't blank the pool for minutes.
   */
  relayToRelay?: boolean
  parseRoute(request: FastifyRequest, body: Record<string, unknown>): ParsedRoute
  normalizeModel?: (model: string) => string
  prepareBody?: (
    body: Record<string, unknown>,
    ctx: PrepareBodyContext,
  ) => Record<string, unknown>
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
  bufferSseResponse?: (
    text: string,
    meta: RelayMeta,
  ) => { body: unknown; usage: UsageData; status?: 'error'; httpStatus?: number }
  /** Optional payload transform applied to each SSE event / buffered JSON body. */
  transformEventData?: (data: unknown) => unknown
  /**
   * Optional stateful, one-chunk-to-many-events stream transform. Mutually
   * exclusive with `transformEventData` — providers should pick one. Used by
   * the DeepSeek Responses adapter to translate chat/completions chunks into
   * a Responses-API event sequence.
   */
  createStreamTransform?: () => StreamTransform
  /** Provider-aware request summary used for usage logs. */
  summarizeRequestInput?: (body: Record<string, unknown>) => string | null
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
  // Route key only — provider.id stays 'claude' so account pool, allowed-
  // provider checks and usage records reuse the existing Claude setup. Lets an
  // OpenAI Chat Completions client talk to a Claude subscription: the request
  // is converted to Messages, the streamed response translated back to
  // chat.completion chunks (buffered to JSON for non-stream clients).
  'claude-chat': {
    id: 'claude',
    forceStream: true,
    parseRoute: (_req, body) => ({
      model: typeof body.model === 'string' ? body.model : '',
      action: 'chat.completions',
    }),
    callUpstream: (token, body, _ctx) => relayClaudeChatCompletions(token, body),
    createStreamParser: claudeUsage.createStreamParser,
    parseJsonUsage: claudeUsage.parseJsonUsage,
    parseStreamEventsFrom: 'upstream',
    bufferSseResponse: (text, meta) => claudeSseToChatCompletion(text, meta.model),
    createStreamTransform: createClaudeChatCompletionsStreamTransform,
  },
  openai: {
    id: 'openai',
    forceStream: true, // Codex backend itself rejects non-streaming.
    responsesProtocol: true,
    parseRoute: (_req, body) => ({
      model: typeof body.model === 'string' ? body.model : '',
      action: 'responses',
    }),
    callUpstream: (token, body, _ctx) => relayOpenaiResponses(token, body, {
      allowImageGeneration: config.OPENAI_IMAGE_GENERATION_ENABLED,
    }),
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
  // Grok (xAI) subscription upstream. Native OpenAI Responses + Chat Completions
  // at api.x.ai, so it reuses the OpenAI usage parsers. Responses is the primary
  // surface (Codex CLI); the -chat handler serves OpenAI-compatible clients.
  grok: {
    id: 'grok',
    forceStream: true,
    responsesProtocol: true,
    normalizeModel: mapGrokModel,
    parseRoute: (_req, body) => ({
      model: typeof body.model === 'string' ? body.model : '',
      action: 'responses',
    }),
    callUpstream: (token, body, _ctx) => relayGrokResponses(token, body),
    createStreamParser: openaiUsage.createStreamParser,
    parseJsonUsage: openaiUsage.parseJsonUsage,
  },
  'grok-chat': {
    id: 'grok',
    forceStream: false,
    normalizeModel: mapGrokModel,
    parseRoute: (_req, body) => ({
      model: typeof body.model === 'string' ? body.model : '',
      action: 'chat.completions',
    }),
    callUpstream: (token, body, _ctx) => relayGrokChatCompletions(token, body),
    createStreamParser: createChatCompletionStreamParser,
    parseJsonUsage: parseChatCompletionUsage,
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
    normalizeModel: mapDeepseekModel,
    parseRoute: (_req, body) => ({
      model: typeof body.model === 'string' ? body.model : '',
      action: 'messages',
    }),
    prepareBody: (body, ctx) =>
      withDeepseekUserIsolation(body, 'messages', ctx.apiKeyId, ctx.userId),
    callUpstream: (token, body, _ctx) => relayDeepseekMessages(token, body),
    createStreamParser: deepseekUsage.createStreamParser,
    parseJsonUsage: deepseekUsage.parseJsonUsage,
  },
  'deepseek-chat': {
    id: 'deepseek',
    forceStream: false,
    normalizeModel: mapDeepseekModel,
    parseRoute: (_req, body) => ({
      model: typeof body.model === 'string' ? body.model : '',
      action: 'chat.completions',
    }),
    prepareBody: (body, ctx) =>
      withDeepseekUserIsolation(body, 'chat.completions', ctx.apiKeyId, ctx.userId),
    callUpstream: (token, body, _ctx) => relayDeepseekChatCompletions(token, body),
    createStreamParser: createChatCompletionStreamParser,
    parseJsonUsage: parseChatCompletionUsage,
  },
  // Route key only — provider.id stays 'deepseek' so account pool, allowed-
  // provider checks, and usage records all reuse the existing deepseek setup.
  // Backed by DeepSeek's native Responses endpoint. DeepSeek currently
  // supports this surface on V4 Flash; the model normalizer enforces that.
  'deepseek-responses': {
    id: 'deepseek',
    forceStream: false,
    responsesProtocol: true,
    normalizeModel: mapDeepseekResponsesModel,
    parseRoute: (_req, body) => ({
      model: typeof body.model === 'string' ? body.model : '',
      action: 'responses',
    }),
    prepareBody: (body, ctx) =>
      withDeepseekUserIsolation(body, 'responses', ctx.apiKeyId, ctx.userId),
    callUpstream: (token, body, _ctx) => relayDeepseekResponses(token, body),
    createStreamParser: deepseekResponsesUsage.createStreamParser,
    parseJsonUsage: deepseekResponsesUsage.parseJsonUsage,
  },
  // Xiaomi MiMo — same shape as DeepSeek: Anthropic-compatible /v1/messages,
  // plus OpenAI Chat-Completions and a Responses-API adapter for Codex CLI.
  xiaomi: {
    id: 'xiaomi',
    forceStream: false,
    normalizeModel: mapXiaomiResponsesModel,
    parseRoute: (_req, body) => ({
      model: typeof body.model === 'string' ? body.model : '',
      action: 'messages',
    }),
    callUpstream: (token, body, _ctx) => relayXiaomiMessages(token, body),
    createStreamParser: xiaomiUsage.createStreamParser,
    parseJsonUsage: xiaomiUsage.parseJsonUsage,
  },
  'xiaomi-chat': {
    id: 'xiaomi',
    forceStream: false,
    normalizeModel: mapXiaomiResponsesModel,
    parseRoute: (_req, body) => ({
      model: typeof body.model === 'string' ? body.model : '',
      action: 'chat.completions',
    }),
    callUpstream: (token, body, _ctx) => relayXiaomiChatCompletions(token, body),
    createStreamParser: createChatCompletionStreamParser,
    parseJsonUsage: parseChatCompletionUsage,
  },
  // Route key only — provider.id stays 'xiaomi' so account pool, allowed-
  // provider checks, and usage records all reuse the existing xiaomi setup.
  // Backed by MiMo's OpenAI-compatible chat/completions endpoint with a
  // Responses-API ↔ Chat-Completions stream converter for Codex CLI.
  'xiaomi-responses': {
    id: 'xiaomi',
    forceStream: true,
    responsesProtocol: true,
    normalizeModel: mapXiaomiResponsesModel,
    parseRoute: (_req, body) => ({
      model: typeof body.model === 'string' ? body.model : '',
      action: 'responses',
    }),
    callUpstream: (token, body, _ctx) => relayXiaomiResponses(token, body),
    createStreamParser: xiaomiResponsesUsage.createStreamParser,
    parseJsonUsage: xiaomiResponsesUsage.parseJsonUsage,
    createStreamTransform: createXiaomiResponsesStreamTransform,
  },
  // Zhipu GLM (BigModel) — same shape as DeepSeek/Xiaomi: Anthropic-compatible
  // /v1/messages (https://open.bigmodel.cn/api/anthropic), plus OpenAI Chat-
  // Completions and a Responses-API adapter for Codex CLI.
  zhipu: {
    id: 'zhipu',
    forceStream: false,
    normalizeModel: mapZhipuResponsesModel,
    parseRoute: (_req, body) => ({
      model: typeof body.model === 'string' ? body.model : '',
      action: 'messages',
    }),
    callUpstream: (token, body, _ctx) => relayZhipuMessages(token, body),
    createStreamParser: zhipuUsage.createStreamParser,
    parseJsonUsage: zhipuUsage.parseJsonUsage,
  },
  'zhipu-chat': {
    id: 'zhipu',
    forceStream: false,
    normalizeModel: mapZhipuResponsesModel,
    parseRoute: (_req, body) => ({
      model: typeof body.model === 'string' ? body.model : '',
      action: 'chat.completions',
    }),
    callUpstream: (token, body, _ctx) => relayZhipuChatCompletions(token, body),
    createStreamParser: createChatCompletionStreamParser,
    parseJsonUsage: parseChatCompletionUsage,
  },
  // Route key only — provider.id stays 'zhipu' so account pool, allowed-
  // provider checks, and usage records all reuse the existing zhipu setup.
  // Backed by GLM's OpenAI-compatible chat/completions endpoint with a
  // Responses-API ↔ Chat-Completions stream converter for Codex CLI.
  'zhipu-responses': {
    id: 'zhipu',
    forceStream: true,
    responsesProtocol: true,
    normalizeModel: mapZhipuResponsesModel,
    parseRoute: (_req, body) => ({
      model: typeof body.model === 'string' ? body.model : '',
      action: 'responses',
    }),
    callUpstream: (token, body, _ctx) => relayZhipuResponses(token, body),
    createStreamParser: zhipuResponsesUsage.createStreamParser,
    parseJsonUsage: zhipuResponsesUsage.parseJsonUsage,
    createStreamTransform: createZhipuResponsesStreamTransform,
  },
  // Qwen (通义千问 / Alibaba DashScope) — same shape as DeepSeek/Xiaomi/Zhipu:
  // Anthropic-compatible /v1/messages (dashscope.aliyuncs.com/apps/anthropic),
  // plus OpenAI Chat-Completions and a Responses-API adapter for Codex CLI.
  qwen: {
    id: 'qwen',
    forceStream: false,
    normalizeModel: mapQwenResponsesModel,
    parseRoute: (_req, body) => ({
      model: typeof body.model === 'string' ? body.model : '',
      action: 'messages',
    }),
    callUpstream: (token, body, _ctx) => relayQwenMessages(token, body),
    createStreamParser: qwenUsage.createStreamParser,
    parseJsonUsage: qwenUsage.parseJsonUsage,
  },
  'qwen-chat': {
    id: 'qwen',
    forceStream: false,
    normalizeModel: mapQwenResponsesModel,
    parseRoute: (_req, body) => ({
      model: typeof body.model === 'string' ? body.model : '',
      action: 'chat.completions',
    }),
    callUpstream: (token, body, _ctx) => relayQwenChatCompletions(token, body),
    createStreamParser: createChatCompletionStreamParser,
    parseJsonUsage: parseChatCompletionUsage,
  },
  // Route key only — provider.id stays 'qwen' so account pool, allowed-provider
  // checks, and usage records all reuse the existing qwen setup. Backed by
  // DashScope's OpenAI-compatible chat/completions endpoint with a Responses-API
  // ↔ Chat-Completions stream converter for Codex CLI.
  'qwen-responses': {
    id: 'qwen',
    forceStream: true,
    responsesProtocol: true,
    normalizeModel: mapQwenResponsesModel,
    parseRoute: (_req, body) => ({
      model: typeof body.model === 'string' ? body.model : '',
      action: 'responses',
    }),
    callUpstream: (token, body, _ctx) => relayQwenResponses(token, body),
    createStreamParser: qwenResponsesUsage.createStreamParser,
    parseJsonUsage: qwenResponsesUsage.parseJsonUsage,
    createStreamTransform: createQwenResponsesStreamTransform,
  },
  // Kimi (月之暗面 / Moonshot) — same shape as DeepSeek/Xiaomi/Zhipu/Qwen:
  // Anthropic-compatible /v1/messages (https://api.moonshot.cn/anthropic), plus
  // OpenAI Chat-Completions and a Responses-API adapter for Codex CLI.
  kimi: {
    id: 'kimi',
    forceStream: false,
    normalizeModel: mapKimiResponsesModel,
    parseRoute: (_req, body) => ({
      model: typeof body.model === 'string' ? body.model : '',
      action: 'messages',
    }),
    callUpstream: (token, body, _ctx) => relayKimiMessages(token, body),
    createStreamParser: kimiUsage.createStreamParser,
    parseJsonUsage: kimiUsage.parseJsonUsage,
  },
  'kimi-chat': {
    id: 'kimi',
    forceStream: false,
    normalizeModel: mapKimiResponsesModel,
    parseRoute: (_req, body) => ({
      model: typeof body.model === 'string' ? body.model : '',
      action: 'chat.completions',
    }),
    callUpstream: (token, body, _ctx) => relayKimiChatCompletions(token, body),
    createStreamParser: createChatCompletionStreamParser,
    parseJsonUsage: parseChatCompletionUsage,
  },
  // Route key only — provider.id stays 'kimi' so account pool, allowed-provider
  // checks, and usage records all reuse the existing kimi setup. Backed by
  // Moonshot's OpenAI-compatible chat/completions endpoint with a Responses-API
  // ↔ Chat-Completions stream converter for Codex CLI.
  'kimi-responses': {
    id: 'kimi',
    forceStream: true,
    responsesProtocol: true,
    normalizeModel: mapKimiResponsesModel,
    parseRoute: (_req, body) => ({
      model: typeof body.model === 'string' ? body.model : '',
      action: 'responses',
    }),
    callUpstream: (token, body, _ctx) => relayKimiResponses(token, body),
    createStreamParser: kimiResponsesUsage.createStreamParser,
    parseJsonUsage: kimiResponsesUsage.parseJsonUsage,
    createStreamTransform: createKimiResponsesStreamTransform,
  },
  sub2api: {
    id: 'sub2api',
    forceStream: false,
    relayToRelay: true,
    parseRoute: (_req, body) => ({
      model: typeof body.model === 'string' ? body.model : '',
      action: 'messages',
    }),
    callUpstream: (token, body, ctx) => relaySub2ApiMessages(token, ctx.account.proxyUrl, body),
    createStreamParser: claudeUsage.createStreamParser,
    parseJsonUsage: claudeUsage.parseJsonUsage,
  },
  'sub2api-chat': {
    id: 'sub2api',
    forceStream: false,
    relayToRelay: true,
    parseRoute: (_req, body) => ({
      model: typeof body.model === 'string' ? body.model : '',
      action: 'chat.completions',
    }),
    callUpstream: (token, body, ctx) => relaySub2ApiChatCompletions(token, ctx.account.proxyUrl, body),
    createStreamParser: createChatCompletionStreamParser,
    parseJsonUsage: parseChatCompletionUsage,
  },
  'sub2api-responses': {
    id: 'sub2api',
    forceStream: true,
    responsesProtocol: true,
    relayToRelay: true,
    parseRoute: (_req, body) => ({
      model: typeof body.model === 'string' ? body.model : '',
      action: 'responses',
    }),
    callUpstream: (token, body, ctx) => relaySub2ApiResponses(token, ctx.account.proxyUrl, body),
    createStreamParser: openaiUsage.createStreamParser,
    parseJsonUsage: openaiUsage.parseJsonUsage,
  },
}

interface RelayMeta {
  apiKeyId: string
  userId: string | null
  accountId: string
  provider: string
  model: string
  requestInput: string | null
  sessionKeyHash: string | null
  sessionSource: string | null
  startedAt: number
  multiplier: number
  billTo: 'subscription' | 'balance'
  subscriptionId: string | null
}

interface UpstreamFailure {
  penalty: 'rate_limited' | 'error' | null
  retryable: boolean
  resetAt?: number | null
  /** When true the account token is permanently invalid — disable it instead of cooldown. */
  disable?: boolean
  /**
   * When true the failure is attributable to the requested model only, so the
   * cooldown applies to that model (metadata.modelCooldowns) instead of the
   * whole account. Set for OpenAI rate-limit shapes that carry no account-wide
   * Codex quota-window evidence (e.g. a plan-gated model's limit).
   */
  modelScoped?: boolean
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

function isAnthropicWindowExceeded(headers: Headers, window: '5h' | '7d' | '7d_oi'): boolean {
  const prefix = `anthropic-ratelimit-unified-${window}-`
  if (headers.get(`${prefix}surpassed-threshold`)?.toLowerCase() === 'true') return true
  const utilization = headerNumber(headers, `${prefix}utilization`)
  return utilization != null && utilization >= 1
}

export function isAnthropicFableOnlyWindowExceeded(headers: Headers): boolean {
  return (
    isAnthropicWindowExceeded(headers, '7d_oi') &&
    !isAnthropicWindowExceeded(headers, '5h') &&
    !isAnthropicWindowExceeded(headers, '7d')
  )
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
  const quota = extractAccountQuota('openai', headers)
  if (!quota) return null

  const exceeded = quota.windows.filter((window) => window.exceeded)
  if (exceeded.length) return pickLater(exceeded.map((window) => window.resetAt))
  return pickLater(quota.windows.map((window) => window.resetAt))
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

function isWorkspaceDeactivated(text: string): boolean {
  try {
    const body = JSON.parse(text) as { detail?: { code?: string } }
    return body.detail?.code === 'deactivated_workspace'
  } catch {
    return false
  }
}

/** Exported for unit testing the failure classification / model-scope rules. */
export async function classifyUpstreamFailure(
  provider: string,
  response: Response,
): Promise<UpstreamFailure> {
  if (response.status === 429) {
    const text = await readErrorText(response)
    if (provider === 'claude' && isAnthropicFableOnlyWindowExceeded(response.headers)) {
      return { penalty: null, retryable: true }
    }
    return {
      penalty: 'rate_limited',
      retryable: true,
      resetAt: parseRateLimitReset(provider, response, text),
      modelScoped: isOpenaiModelScopedLimit(provider, response),
    }
  }
  if (response.status === 401) {
    const text = await readErrorText(response)
    if (isTokenRevoked(text)) {
      return { penalty: null, retryable: true, disable: true }
    }
    return { penalty: 'error', retryable: true }
  }
  if (response.status === 402) {
    const text = await readErrorText(response)
    if (isWorkspaceDeactivated(text)) {
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
      return {
        penalty: 'rate_limited',
        retryable: true,
        resetAt: parseRateLimitReset(provider, response, text),
        modelScoped: isOpenaiModelScopedLimit(provider, response),
      }
    }
  }
  return { penalty: null, retryable: false }
}

/**
 * OpenAI rate-limit scope heuristic: the Codex backend reports account-wide
 * 5h/weekly quota windows via response headers. A rate-limit response WITHOUT
 * that evidence (e.g. a plan-gated model's 400/429) is most likely scoped to
 * the requested model, so we cool down only that model instead of blanking
 * the whole account for every other model. The trade-off leans deliberately
 * toward availability: a mis-scoped account-wide limit just retries other
 * models against the same account, while the reverse (account-wide cooldown
 * for a model-only limit) takes the account out of rotation entirely.
 */
function isOpenaiModelScopedLimit(provider: string, response: Response): boolean {
  return provider === 'openai' && parseCodexReset(response.headers) == null
}

/** Registers the provider relay endpoints. */
export function registerRelayRoutes(app: FastifyInstance): void {
  const imageBodyLimit = 64 * 1024 * 1024
  app.addContentTypeParser(/^multipart\/form-data\b/i, { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body)
  })
  const claudeHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS.claude!)
  const claudeChatHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS['claude-chat']!)
  const openaiHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS.openai!)
  const openaiChatHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS['openai-chat']!)
  const openaiImagesHandler = (endpoint: OpenAIImagesEndpoint) =>
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      if (!config.OPENAI_IMAGE_GENERATION_ENABLED) {
        await reply.code(403).send({
          error: {
            type: 'permission_error',
            code: 'image_generation_disabled',
            message: 'OpenAI image generation is disabled on this gateway.',
          },
        })
        return
      }
      let body: OpenAIImagesRequestBody
      try {
        const contentType = Array.isArray(request.headers['content-type'])
          ? request.headers['content-type'][0] ?? ''
          : request.headers['content-type'] ?? ''
        body = parseOpenAIImagesRequest(request.body, contentType, endpoint, {
          deferModelValidation: true,
        })
        validateOpenAIImagesRequestModel(
          body,
          mapRequestedModel(body.model, request.apiKey!.modelMappings),
        )
      } catch (error) {
        await reply.code(400).send({
          error: {
            type: 'invalid_request_error',
            code: 'invalid_image_request',
            message: (error as Error).message,
          },
        })
        return
      }
      const requestedModel = body.model
      const mappedRequest: OpenAIImagesRequestBody = {
        ...body,
        model: mapRequestedModel(requestedModel, request.apiKey!.modelMappings),
      }
      const provider: ProviderHandler = {
        id: 'openai',
        forceStream: false,
        parseRoute: () => ({
          model: requestedModel,
          action: `images.${endpoint}`,
        }),
        callUpstream: (token, input) => relayOpenaiImages(token, input),
        createStreamParser: () => createOpenAIImagesUsageParser(mappedRequest),
        parseJsonUsage: () => emptyUsage(),
        parseStreamEventsFrom: 'upstream',
        bufferSseResponse: (text) => convertOpenAIImagesSse(text, mappedRequest),
        createStreamTransform: () => createOpenAIImagesStreamTransform(mappedRequest),
        summarizeRequestInput: summarizeOpenAIImagesRequest,
      }
      await executeRelay(request, reply, provider, body)
    }
  const geminiHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS.gemini!)
  const deepseekHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS.deepseek!)
  const deepseekChatHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS['deepseek-chat']!)
  const deepseekResponsesHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS['deepseek-responses']!)
  const xiaomiHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS.xiaomi!)
  const xiaomiChatHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS['xiaomi-chat']!)
  const xiaomiResponsesHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS['xiaomi-responses']!)
  const zhipuHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS.zhipu!)
  const zhipuChatHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS['zhipu-chat']!)
  const zhipuResponsesHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS['zhipu-responses']!)
  const qwenHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS.qwen!)
  const qwenChatHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS['qwen-chat']!)
  const qwenResponsesHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS['qwen-responses']!)
  const kimiHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS.kimi!)
  const kimiChatHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS['kimi-chat']!)
  const kimiResponsesHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS['kimi-responses']!)
  const grokHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS.grok!)
  const grokChatHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS['grok-chat']!)
  const sub2apiHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS.sub2api!)
  const sub2apiChatHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS['sub2api-chat']!)
  const sub2apiResponsesHandler = (request: FastifyRequest, reply: FastifyReply) =>
    executeRelay(request, reply, PROVIDERS['sub2api-responses']!)

  app.post('/api/claude/v1/messages', { preHandler: requireApiKey }, claudeHandler)
  // Claude via the OpenAI Chat Completions surface: OpenAI clients can point
  // base URL=https://your-host/api/claude/v1 and call a Claude subscription.
  app.post('/api/claude/v1/chat/completions', { preHandler: requireApiKey }, claudeChatHandler)
  app.post('/api/openai/v1/responses', { preHandler: requireApiKey }, openaiHandler)
  app.post('/api/openai/v1/chat/completions', { preHandler: requireApiKey }, openaiChatHandler)
  app.post('/api/openai/v1/images/generations', { preHandler: requireApiKey, bodyLimit: imageBodyLimit }, openaiImagesHandler('generations'))
  app.post('/api/openai/v1/images/edits', { preHandler: requireApiKey, bodyLimit: imageBodyLimit }, openaiImagesHandler('edits'))
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
  // Xiaomi MiMo: Anthropic-compatible endpoint under /api/xiaomi prefix.
  // Claude Code: ANTHROPIC_BASE_URL=https://your-host/api/xiaomi
  app.post('/api/xiaomi/v1/messages', { preHandler: requireApiKey }, xiaomiHandler)
  // Xiaomi MiMo: OpenAI-compatible Chat Completions endpoint.
  // OpenAI clients: base URL=https://your-host/api/xiaomi/v1
  app.post('/api/xiaomi/v1/chat/completions', { preHandler: requireApiKey }, xiaomiChatHandler)
  // Xiaomi MiMo: OpenAI Responses-API surface for Codex CLI. The relay rewrites
  // requests into chat/completions and translates the SSE stream back.
  // Codex: configure base_url=https://your-host/api/xiaomi
  app.post('/api/xiaomi/v1/responses', { preHandler: requireApiKey }, xiaomiResponsesHandler)
  // Zhipu GLM: Anthropic-compatible endpoint under /api/zhipu prefix.
  // Claude Code: ANTHROPIC_BASE_URL=https://your-host/api/zhipu
  app.post('/api/zhipu/v1/messages', { preHandler: requireApiKey }, zhipuHandler)
  // Zhipu GLM: OpenAI-compatible Chat Completions endpoint.
  // OpenAI clients: base URL=https://your-host/api/zhipu/v1
  app.post('/api/zhipu/v1/chat/completions', { preHandler: requireApiKey }, zhipuChatHandler)
  // Zhipu GLM: OpenAI Responses-API surface for Codex CLI. The relay rewrites
  // requests into chat/completions and translates the SSE stream back.
  // Codex: configure base_url=https://your-host/api/zhipu
  app.post('/api/zhipu/v1/responses', { preHandler: requireApiKey }, zhipuResponsesHandler)
  // Qwen (通义千问): Anthropic-compatible endpoint under /api/qwen prefix.
  // Claude Code: ANTHROPIC_BASE_URL=https://your-host/api/qwen
  app.post('/api/qwen/v1/messages', { preHandler: requireApiKey }, qwenHandler)
  // Qwen: OpenAI-compatible Chat Completions endpoint.
  // OpenAI clients: base URL=https://your-host/api/qwen/v1
  app.post('/api/qwen/v1/chat/completions', { preHandler: requireApiKey }, qwenChatHandler)
  // Qwen: OpenAI Responses-API surface for Codex CLI. The relay rewrites
  // requests into chat/completions and translates the SSE stream back.
  // Codex: configure base_url=https://your-host/api/qwen
  app.post('/api/qwen/v1/responses', { preHandler: requireApiKey }, qwenResponsesHandler)
  // Kimi (月之暗面): Anthropic-compatible endpoint under /api/kimi prefix.
  // Claude Code: ANTHROPIC_BASE_URL=https://your-host/api/kimi
  app.post('/api/kimi/v1/messages', { preHandler: requireApiKey }, kimiHandler)
  // Kimi: OpenAI-compatible Chat Completions endpoint.
  // OpenAI clients: base URL=https://your-host/api/kimi/v1
  app.post('/api/kimi/v1/chat/completions', { preHandler: requireApiKey }, kimiChatHandler)
  // Kimi: OpenAI Responses-API surface for Codex CLI. The relay rewrites
  // requests into chat/completions and translates the SSE stream back.
  // Codex: configure base_url=https://your-host/api/kimi
  app.post('/api/kimi/v1/responses', { preHandler: requireApiKey }, kimiResponsesHandler)
  // Grok (xAI): OpenAI Responses-API surface for Codex CLI.
  // Codex: configure base_url=https://your-host/api/grok
  app.post('/api/grok/v1/responses', { preHandler: requireApiKey }, grokHandler)
  // Grok: OpenAI-compatible Chat Completions endpoint.
  // OpenAI clients: base URL=https://your-host/api/grok/v1
  app.post('/api/grok/v1/chat/completions', { preHandler: requireApiKey }, grokChatHandler)
  // Sub2API: relay-to-relay upstream. Configure each account with the target
  // Sub2API Base URL and API Key; requests are forwarded without model rewrites.
  app.post('/api/sub2api/v1/messages', { preHandler: requireApiKey }, sub2apiHandler)
  app.post('/api/sub2api/v1/chat/completions', { preHandler: requireApiKey }, sub2apiChatHandler)
  app.post('/api/sub2api/v1/responses', { preHandler: requireApiKey }, sub2apiResponsesHandler)


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
  app.get('/api/xiaomi/v1/models', { preHandler: requireApiKey }, (request, reply) =>
    sendOpenAIStyleModelList(request, reply, 'xiaomi'),
  )
  app.get('/api/zhipu/v1/models', { preHandler: requireApiKey }, (request, reply) =>
    sendOpenAIStyleModelList(request, reply, 'zhipu'),
  )
  app.get('/api/qwen/v1/models', { preHandler: requireApiKey }, (request, reply) =>
    sendOpenAIStyleModelList(request, reply, 'qwen'),
  )
  app.get('/api/kimi/v1/models', { preHandler: requireApiKey }, (request, reply) =>
    sendOpenAIStyleModelList(request, reply, 'kimi'),
  )
  app.get('/api/sub2api/v1/models', { preHandler: requireApiKey }, (request, reply) =>
    sendOpenAIStyleModelList(request, reply, 'sub2api'),
  )
  app.get('/api/gemini/v1beta/models', { preHandler: requireApiKey }, sendGeminiModelList)
  app.get('/api/gemini/v1beta/models/*', { preHandler: requireApiKey }, sendGeminiModel)

  app.get('/v1/models', { preHandler: requireApiKey }, (request, reply) =>
    sendOpenAIStyleModelList(request, reply),
  )
  app.get('/models', { preHandler: requireApiKey }, (request, reply) =>
    sendOpenAIStyleModelList(request, reply),
  )
  app.get('/v1beta/models', { preHandler: requireApiKey }, sendGeminiModelList)
  app.get('/v1beta/models/*', { preHandler: requireApiKey }, sendGeminiModel)

  // Clean provider-native aliases so one bare base URL serves every provider:
  // - Claude:       ANTHROPIC_BASE_URL = https://api.example.com  (+ /v1/messages)
  // - OpenAI/Codex: base_url           = https://api.example.com  (+ /responses)
  // - Gemini:       base URL           = https://api.example.com  (+ /v1beta/...)
  // DeepSeek (deepseek-*), Xiaomi MiMo (mimo-*) and Zhipu GLM (glm-*) share these
  // paths and are selected by model name, so they need no separate prefix — see
  // dispatchByModel.
  const messagesHandler = dispatchByModel(PROVIDERS.claude!, [
    { test: /^deepseek/i, handler: PROVIDERS.deepseek! },
    { test: /^mimo/i, handler: PROVIDERS.xiaomi! },
    { test: /^glm/i, handler: PROVIDERS.zhipu! },
    { test: /^qwen/i, handler: PROVIDERS.qwen! },
    { test: /^(kimi|moonshot)/i, handler: PROVIDERS.kimi! },
  ], PROVIDERS.sub2api!)
  const responsesHandler = dispatchByModel(PROVIDERS.openai!, [
    { test: /^deepseek/i, handler: PROVIDERS['deepseek-responses']! },
    { test: /^mimo/i, handler: PROVIDERS['xiaomi-responses']! },
    { test: /^glm/i, handler: PROVIDERS['zhipu-responses']! },
    { test: /^qwen/i, handler: PROVIDERS['qwen-responses']! },
    { test: /^(kimi|moonshot)/i, handler: PROVIDERS['kimi-responses']! },
    { test: /^grok/i, handler: PROVIDERS.grok! },
  ], PROVIDERS['sub2api-responses']!)
  const chatHandler = dispatchByModel(PROVIDERS['openai-chat']!, [
    { test: /^claude/i, handler: PROVIDERS['claude-chat']! },
    { test: /^deepseek/i, handler: PROVIDERS['deepseek-chat']! },
    { test: /^mimo/i, handler: PROVIDERS['xiaomi-chat']! },
    { test: /^glm/i, handler: PROVIDERS['zhipu-chat']! },
    { test: /^qwen/i, handler: PROVIDERS['qwen-chat']! },
    { test: /^(kimi|moonshot)/i, handler: PROVIDERS['kimi-chat']! },
    { test: /^grok/i, handler: PROVIDERS['grok-chat']! },
  ], PROVIDERS['sub2api-chat']!)
  app.post('/v1/messages', { preHandler: requireApiKey }, messagesHandler)
  app.post('/v1/responses', { preHandler: requireApiKey }, responsesHandler)
  app.post('/v1/chat/completions', { preHandler: requireApiKey }, chatHandler)
  app.post('/v1/images/generations', { preHandler: requireApiKey, bodyLimit: imageBodyLimit }, openaiImagesHandler('generations'))
  app.post('/v1/images/edits', { preHandler: requireApiKey, bodyLimit: imageBodyLimit }, openaiImagesHandler('edits'))
  // Codex appends `/responses` to its base_url; OpenAI-compatible clients hit
  // `/chat/completions`. Register the un-prefixed forms too so the base URL can
  // be the bare domain (no trailing /v1).
  app.post('/responses', { preHandler: requireApiKey }, responsesHandler)
  app.post('/chat/completions', { preHandler: requireApiKey }, chatHandler)
  app.post('/v1beta/models/*', { preHandler: requireApiKey }, geminiHandler)
}

/**
 * Clean-endpoint dispatch: route by the (mapping-applied) model name so a
 * single bare base URL serves every provider. Model-routed backends are tried
 * in order (e.g. `deepseek-*` → DeepSeek, `mimo-*` → Xiaomi); anything that
 * matches none uses the path's default provider. This is a cheap in-memory
 * check (no extra upstream round-trip), so it adds no latency.
 */
function dispatchByModel(
  defaultHandler: ProviderHandler,
  routed: Array<{ test: RegExp; handler: ProviderHandler }>,
  sub2apiHandler?: ProviderHandler,
) {
  return (request: FastifyRequest, reply: FastifyReply) => {
    const apiKey = request.apiKey!
    // A key scoped exclusively to sub2api routes every bare-domain request to
    // its sub2api upstream. Sub2API forwards model names verbatim and they
    // overlap with the native providers, so there is no way to tell them apart
    // by model name — the key's allow-list is the only unambiguous signal.
    if (
      sub2apiHandler &&
      apiKey.allowedProviders?.length === 1 &&
      apiKey.allowedProviders[0] === 'sub2api'
    ) {
      return executeRelay(request, reply, sub2apiHandler)
    }
    const body = (request.body ?? {}) as Record<string, unknown>
    const raw = typeof body.model === 'string' ? body.model : ''
    const mapped = mapRequestedModel(raw, apiKey.modelMappings)
    const match = routed.find((r) => r.test.test(raw) || r.test.test(mapped))
    return executeRelay(request, reply, match ? match.handler : defaultHandler)
  }
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
  bodyOverride?: Record<string, unknown>,
): Promise<void> {
  const apiKey = request.apiKey!
  const body = bodyOverride ?? (request.body ?? {}) as Record<string, unknown>
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

  // Concurrency gates. Hold a slot for the whole request (including the streamed
  // body) and release it once the response is fully sent. Streaming hijacks the
  // reply, so onResponse hooks can't be relied on — release here.
  //
  // Two independent gates apply, outermost first:
  //   - per-user: caps in-flight requests across ALL of the user's keys, so one
  //     tenant can't starve the shared account pool.
  //   - per-key: caps a single key.
  // Acquire user → key; release key → user (reverse order) so a failed inner
  // acquire never leaks the outer slot.
  const userLimit = apiKey.userConcurrencyLimit
  const userSlotKey = apiKey.userId ? userConcurrencyKey(apiKey.userId) : null
  if (userSlotKey && userLimit != null && !(await acquireSlot(userSlotKey, userLimit))) {
    await reply.code(429).send({ error: 'too many concurrent requests for this user' })
    return
  }
  const concurrencyLimit = apiKey.concurrencyLimit
  if (concurrencyLimit != null && !(await acquireSlot(apiKey.id, concurrencyLimit))) {
    if (userSlotKey && userLimit != null) await releaseSlot(userSlotKey)
    await reply.code(429).send({ error: 'too many concurrent requests for this API key' })
    return
  }
  try {
    const mappedBody = bodyWithMappedModel(body, parsed.model)
    const preparedBody = provider.prepareBody
      ? provider.prepareBody(mappedBody, {
          apiKeyId: apiKey.id,
          userId: apiKey.userId,
          action: parsed.action,
        })
      : mappedBody
    await runRelayLoop(request, reply, provider, preparedBody, parsed)
  } finally {
    if (concurrencyLimit != null) await releaseSlot(apiKey.id)
    if (userSlotKey && userLimit != null) await releaseSlot(userSlotKey)
  }
}

/** Concurrency-gate key for a user's aggregate in-flight requests. */
const userConcurrencyKey = (userId: string): string => `user:${userId}`

function isAnyAllowedModel(models: string[], allowedModels: string[] | null | undefined): boolean {
  if (!allowedModels || allowedModels.length === 0) return true
  return [...new Set(models.map((model) => model.trim()).filter(Boolean))]
    .some((model) => isAllowedModel(model, allowedModels))
}

function bodyWithMappedModel(body: Record<string, unknown>, model: string): Record<string, unknown> {
  if (!model || typeof body.model !== 'string' || body.model === model) return body
  return { ...body, model }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function acquireSlotWithStickyWait(
  slotKey: string,
  limit: number,
  waitMs: number,
): Promise<boolean> {
  if (await acquireSlot(slotKey, limit)) return true
  if (waitMs <= 0) return false

  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    await sleep(Math.min(STICKY_SLOT_POLL_MS, Math.max(1, deadline - Date.now())))
    if (await acquireSlot(slotKey, limit)) return true
  }
  return false
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
  const session = computeSessionInfo(provider.id, apiKey.id, request.headers, body)
  const sessionKey = session?.key ?? null
  const tried: string[] = []
  // sub2api & friends: a transient upstream error means "retry the same account"
  // (the gateway rotates its own backends), not "blackball this credential".
  const relayToRelay = provider.relayToRelay === true

  // A vanished client shouldn't burn more upstream quota: note the disconnect
  // and stop before starting the NEXT attempt. In-flight upstream requests are
  // deliberately left alone — they complete and their usage is recorded
  // normally, so billing never sees a half-aborted request.
  let clientGone = false
  reply.raw.once('close', () => {
    if (!reply.raw.writableEnded) clientGone = true
  })

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (clientGone) {
      request.log.info(`client disconnected; skipping further ${provider.id} attempts`)
      return
    }
    const account = await pickAccount(
      provider.id,
      tried,
      sessionKey,
      apiKey.accountGroupId ?? null,
      parsed.model,
    )
    if (!account) {
      await reply.code(503).send({
        error: tried.length
          ? `all ${provider.id} accounts are unavailable`
          : `no ${provider.id} account configured`,
      })
      return
    }

    const accountLimit = account.concurrencyLimit
    const accountSlotKey = accountConcurrencyKey(account.id)
    const stickyAccountId = sessionKey ? await getStickyAccountId(sessionKey) : null
    const isStickySelection = stickyAccountId === account.id
    const acquired =
      accountLimit == null ||
      (isStickySelection
        ? await acquireSlotWithStickyWait(accountSlotKey, accountLimit, config.STICKY_SESSION_WAIT_MS)
        : await acquireSlot(accountSlotKey, accountLimit))
    if (!acquired) {
      tried.push(account.id)
      continue
    }
    tried.push(account.id)

    let token: string
    try {
      token = await ensureFreshToken(account)
    } catch (err) {
      if (err instanceof PermanentRefreshError) {
        // Account was already disabled inside refreshAccountToken. Do NOT
        // penalize — that would overwrite `disabled` with `error` + cooldown
        // and revive the dead token into the pool. Just release and move on.
        request.log.warn(`account ${account.id} disabled: refresh token invalid (${err.signal})`)
        if (sessionKey) await clearStickyAccount(sessionKey)
        if (accountLimit != null) await releaseSlot(accountSlotKey)
        continue
      }
      request.log.warn(`token refresh failed for ${account.id}: ${(err as Error).message}`)
      await penalizeAccount(account.id, 'error')
      if (accountLimit != null) await releaseSlot(accountSlotKey)
      continue
    }

    const startedAt = Date.now()
    let upstream: Response
    try {
      upstream = await provider.callUpstream(token, body, {
        model: parsed.model,
        action: parsed.action,
        account: { id: account.id, metadata: account.metadata, proxyUrl: account.proxyUrl },
      })
    } catch (err) {
      request.log.warn(`upstream call failed for ${account.id}: ${(err as Error).message}`)
      if (relayToRelay && attempt < MAX_ATTEMPTS - 1) {
        // Transient network error reaching the sub2api gateway: retry the same
        // account (don't cool it down or exclude it) so the next attempt can
        // land on a healthy backend behind the gateway.
        if (accountLimit != null) await releaseSlot(accountSlotKey)
        tried.pop()
        continue
      }
      await penalizeAccount(
        account.id,
        'error',
        relayToRelay ? Date.now() + RELAY_TO_RELAY_COOLDOWN_MS : undefined,
      )
      if (accountLimit != null) await releaseSlot(accountSlotKey)
      continue
    }

    try {
      const quota = extractAccountQuota(provider.id, upstream.headers)
      if (quota) await updateAccountQuota(account.id, quota)

      const failure = await classifyUpstreamFailure(provider.id, upstream)
      const lastAttempt = attempt === MAX_ATTEMPTS - 1

      if (failure.retryable && !lastAttempt) {
        if (failure.disable) {
          await disableAccount(account.id)
          if (sessionKey) await clearStickyAccount(sessionKey)
        } else if (relayToRelay) {
          // Retry the same sub2api account: the gateway may route the retry to
          // a healthy backend. Don't cool it down or exclude it from the pool.
          tried.pop()
        } else if (failure.penalty) {
          if (failure.modelScoped) {
            await penalizeAccountModel(account.id, parsed.model, failure.penalty, failure.resetAt)
          } else {
            await penalizeAccount(account.id, failure.penalty, failure.resetAt)
          }
        }
        await upstream.body?.cancel().catch(() => {})
        continue
      }

      if (failure.disable) {
        await disableAccount(account.id)
        if (sessionKey) await clearStickyAccount(sessionKey)
      } else if (failure.penalty) {
        // Relay-to-relay retries are exhausted here: apply only a short back-off
        // so subsequent turns recover quickly instead of hitting a multi-minute
        // "no sub2api account" window on a single-account group.
        if (!relayToRelay && failure.modelScoped) {
          await penalizeAccountModel(account.id, parsed.model, failure.penalty, failure.resetAt)
        } else {
          const cooldownUntil = relayToRelay ? Date.now() + RELAY_TO_RELAY_COOLDOWN_MS : failure.resetAt
          await penalizeAccount(account.id, failure.penalty, cooldownUntil)
        }
      } else if (upstream.ok) {
        // Auto-pause: shift traffic off an account whose 5h/7d usage has reached
        // the configured threshold, until the breaching window resets. Only costs
        // a settings lookup when the upstream actually reported a quota snapshot.
        let quotaCooldown: number | null = null
        if (quota) {
          const threshold = resolveAutopausePercent(account.metadata, await getQuotaAutopausePercent())
          quotaCooldown = quotaPauseUntil(quota, threshold)
        }
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
        requestInput: provider.summarizeRequestInput
          ? provider.summarizeRequestInput(body)
          : summarizeRequestInput(body),
        sessionKeyHash: session?.hash ?? null,
        sessionSource: session?.source ?? null,
        startedAt,
        multiplier: apiKey.groupMultiplier ?? 1,
        billTo: apiKey.billTo,
        subscriptionId: apiKey.subscriptionId,
      }
      // Relay-to-relay upstreams are third-party gateways: their error bodies
      // can embed backend hosts, channel names or other internal config. Send
      // this gateway's own sanitized envelope instead of the verbatim body
      // (the Responses-protocol path sanitizes inside sendStreaming). The full
      // upstream body stays server-side in the log for troubleshooting.
      if (relayToRelay && !upstream.ok && !provider.responsesProtocol) {
        await sendSanitizedRelayError(request, reply, upstream, meta)
        return
      }
      if (wantStream) {
        await sendStreaming(reply, upstream, meta, provider)
      } else {
        await sendBuffered(reply, upstream, meta, provider)
      }
      return
    } finally {
      if (accountLimit != null) await releaseSlot(accountSlotKey)
    }
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
// Interval for keepalive comment frames on an SSE stream while the upstream is
// silent, short enough to stay under typical reverse-proxy idle timeouts (~60s).
const STREAM_HEARTBEAT_MS = 15_000

/** True when a content-type is present and is not an SSE stream. */
function isNonStreamContentType(contentType: string | null): boolean {
  return !!contentType && !contentType.includes('text/event-stream')
}

/**
 * Parses a Responses-API JSON body into the response object for a synthesized
 * `response.completed` event, or null if it doesn't look like one. Accepts a
 * bare response object or a `{ response: {...} }` envelope.
 */
function parseResponseObject(text: string): Record<string, unknown> | null {
  try {
    const body = JSON.parse(text) as Record<string, unknown>
    if (!body || typeof body !== 'object') return null
    const resp = (body.response ?? body) as Record<string, unknown>
    if (!resp || typeof resp !== 'object') return null
    if ('output' in resp || 'usage' in resp || resp.object === 'response') return resp
    return null
  } catch {
    return null
  }
}

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
    const extracted = extractUpstreamError(errorText, upstream.status)
    const code = extracted.code
    // Relay-to-relay: the gateway's error text may name internal backends —
    // log the original server-side, forward a URL-redacted message.
    let message = extracted.message
    if (provider.relayToRelay) {
      reply.log.warn(
        `sub2api upstream error for account ${meta.accountId}: HTTP ${upstream.status} ${errorText.slice(0, 2_000)}`,
      )
      message = redactUrls(message)
    }
    raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    for (const event of buildResponsesErrorEvents(message, code)) writeSseData(raw, event)
    raw.end()
    await recordUsage({
      apiKeyId: meta.apiKeyId,
      userId: meta.userId,
      accountId: meta.accountId,
      provider: meta.provider,
      model: meta.model,
      multiplier: meta.multiplier,
      billTo: meta.billTo,
      subscriptionId: meta.subscriptionId,
      usage: emptyUsage(),
      status: 'error',
      latencyMs: Date.now() - meta.startedAt,
      requestInput: meta.requestInput,
      sessionKeyHash: meta.sessionKeyHash,
      sessionSource: meta.sessionSource,
    })
    return
  }

  // Responses-protocol upstream that answers 200 with a non-stream (JSON) body
  // instead of an SSE stream — e.g. Codex remote-compact. Streaming the raw JSON
  // would look like a broken stream (no terminal event) and make the client
  // retry, burning upstream quota. Buffer it and synthesize a proper Responses
  // SSE terminal so the client sees a completed (or cleanly failed) response.
  if (
    responsesProtocol &&
    upstream.ok &&
    isNonStreamContentType(upstream.headers.get('content-type'))
  ) {
    const bodyText = await upstream.text().catch(() => '')
    raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const jsonParser = provider.createStreamParser()
    const jsonState = newResponsesStreamState()
    const responseObject = parseResponseObject(bodyText)
    if (responseObject) {
      const event = { type: 'response.completed', response: responseObject }
      jsonParser.feed(event)
      noteResponsesTerminal(event, jsonState)
      writeSseData(raw, event)
    } else {
      const { code, message } = extractUpstreamError(bodyText, upstream.status)
      const safeMessage = provider.relayToRelay ? redactUrls(message) : message
      for (const event of buildResponsesErrorEvents(safeMessage, code)) {
        noteResponsesTerminal(event, jsonState)
        writeSseData(raw, event)
      }
    }
    raw.end()
    await recordUsage({
      apiKeyId: meta.apiKeyId,
      userId: meta.userId,
      accountId: meta.accountId,
      provider: meta.provider,
      model: meta.model,
      multiplier: meta.multiplier,
      billTo: meta.billTo,
      subscriptionId: meta.subscriptionId,
      usage: jsonParser.result(),
      status: responsesStreamStatus(upstream.ok, responsesProtocol, jsonState),
      latencyMs: Date.now() - meta.startedAt,
      requestInput: meta.requestInput,
      sessionKeyHash: meta.sessionKeyHash,
      sessionSource: meta.sessionSource,
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
  // SSE output means we can safely inject keepalive comment frames while the
  // upstream is silent (e.g. Codex processing a remote-compact) so idle-timeout
  // proxies don't drop the connection. Raw non-SSE passthrough can't take them.
  const sseOutput =
    responsesProtocol ||
    !!useStreamTransform ||
    (upstream.headers.get('content-type')?.includes('text/event-stream') ?? false)

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
  // the client (and whether it was a failure) so we can synthesize one if the
  // stream drops early and record the right usage status.
  const streamState: ResponsesStreamState = { sawTerminal: false, sawFailure: false }

  if (upstream.body) {
    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    let lastActivity = Date.now()
    const heartbeat = sseOutput
      ? setInterval(() => {
          if (Date.now() - lastActivity >= STREAM_HEARTBEAT_MS) {
            try {
              raw.write(': keepalive\n\n')
              lastActivity = Date.now()
            } catch {
              // downstream gone; the read loop will settle it
            }
          }
        }, STREAM_HEARTBEAT_MS)
      : null
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        lastActivity = Date.now()
        buffer += decoder.decode(value, { stream: true })
        // Normalise CRLF so SSE block splitting and multi-line data handling
        // work regardless of the upstream server's newline convention.
        buffer = buffer.replace(/\r\n/g, '\n')
        if (streamTransform) {
          // Stateful multi-event transform: drain whole SSE blocks, feed
          // upstream JSON events to the transform, write each result as its
          // own `data:` line, and feed it to the usage parser.
          let sep: number
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            emitFromStreamTransform(
              raw,
              buffer.slice(0, sep),
              streamTransform,
              parser,
              parseUpstreamStream,
              markFirstToken,
              streamState,
            )
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
            feedSseBlock(buffer.slice(0, sep), parser, streamState)
            buffer = buffer.slice(sep + 2)
          }
        }
      }
    } catch {
      // Client disconnected or upstream aborted — stop quietly.
    } finally {
      if (heartbeat) clearInterval(heartbeat)
    }
  }
  if (streamTransform) {
    for (const event of streamTransform.flush()) {
      if (!parseUpstreamStream && event !== '[DONE]') parser.feed(event)
      noteResponsesTerminal(event, streamState)
      markFirstToken()
      writeSseData(raw, event)
    }
  }
  // Stream ended without a terminal event (upstream dropped mid-response) —
  // append one so Codex stops and reports it instead of reconnecting.
  if (responsesProtocol && !streamState.sawTerminal) {
    streamState.sawFailure = true
    for (const event of buildResponsesErrorEvents(
      'Upstream stream closed before completion.',
      'upstream_stream_closed',
    )) {
      writeSseData(raw, event)
    }
  }
  raw.end()

  await recordUsage({
    apiKeyId: meta.apiKeyId,
    userId: meta.userId,
    accountId: meta.accountId,
    provider: meta.provider,
    model: meta.model,
    multiplier: meta.multiplier,
    billTo: meta.billTo,
    subscriptionId: meta.subscriptionId,
    usage: parser.result(),
    // Responses-protocol success requires a `response.completed` terminal. A
    // `response.failed` / `response.incomplete` (incl. `cyber_policy` blocks) or
    // a dropped stream is an error. Non-Responses providers use upstream.ok.
    status: streamTransform?.status?.() ?? responsesStreamStatus(upstream.ok, responsesProtocol, streamState),
    latencyMs: Date.now() - meta.startedAt,
    firstTokenMs,
    requestInput: meta.requestInput,
    sessionKeyHash: meta.sessionKeyHash,
    sessionSource: meta.sessionSource,
  })
}

const RESPONSES_TERMINAL_EVENTS = new Set([
  'response.completed',
  'response.failed',
  'response.incomplete',
])

/**
 * Classifies a Responses-API SSE event's terminal kind, or null if it isn't a
 * terminal event. `response.completed` is the only success terminal; `failed`
 * and `incomplete` are error terminals.
 */
function responsesTerminalKind(event: unknown): 'completed' | 'failed' | 'incomplete' | null {
  if (!event || typeof event !== 'object') return null
  const type = (event as { type?: unknown }).type
  if (typeof type !== 'string' || !RESPONSES_TERMINAL_EVENTS.has(type)) return null
  if (type === 'response.completed') return 'completed'
  return type === 'response.failed' ? 'failed' : 'incomplete'
}

/**
 * Tracks Responses-protocol terminal events across a stream so usage can be
 * recorded with the right status: a stream is a success only when it reaches
 * `response.completed`; `response.failed` / `response.incomplete` (e.g. a
 * `cyber_policy` hard block) are errors, and a stream that drops with no
 * terminal at all is also an error.
 */
interface ResponsesStreamState {
  sawTerminal: boolean
  sawFailure: boolean
}

/** A fresh stream state for tracking Responses terminal events. */
export function newResponsesStreamState(): ResponsesStreamState {
  return { sawTerminal: false, sawFailure: false }
}

/** Records an event's terminal kind into the stream state. */
export function noteResponsesTerminal(event: unknown, state: ResponsesStreamState): void {
  const kind = responsesTerminalKind(event)
  if (!kind) return
  state.sawTerminal = true
  if (kind !== 'completed') state.sawFailure = true
}

/**
 * The usage-log status for a finished stream. Non-Responses providers key off
 * `upstreamOk` alone; Responses providers additionally require a successful
 * `response.completed` terminal (no failure terminal, no early drop).
 */
export function responsesStreamStatus(
  upstreamOk: boolean,
  responsesProtocol: boolean,
  state: ResponsesStreamState,
): 'success' | 'error' {
  if (!upstreamOk) return 'error'
  if (!responsesProtocol) return 'success'
  return state.sawTerminal && !state.sawFailure ? 'success' : 'error'
}

/** Redacts URLs from a message so upstream hosts/paths never reach clients. */
export function redactUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s"'<>)\]]+/gi, '[redacted-url]')
}

/**
 * Final-failure response for relay-to-relay (sub2api) upstreams: keep the HTTP
 * status plus a URL-redacted code/message extracted from the error body, and
 * rewrite everything else into this gateway's own envelope. The envelope
 * carries both Anthropic-style (`type`/`error.type`) and OpenAI-style
 * (`error.code`/`error.message`) fields so either client family can render it.
 */
async function sendSanitizedRelayError(
  request: FastifyRequest,
  reply: FastifyReply,
  upstream: Response,
  meta: RelayMeta,
): Promise<void> {
  const text = await upstream.text().catch(() => '')
  request.log.warn(
    `sub2api upstream error for account ${meta.accountId}: HTTP ${upstream.status} ${text.slice(0, 2_000)}`,
  )
  const { code, message } = extractUpstreamError(text, upstream.status)
  const usageWrite = recordUsage({
    apiKeyId: meta.apiKeyId,
    userId: meta.userId,
    accountId: meta.accountId,
    provider: meta.provider,
    model: meta.model,
    multiplier: meta.multiplier,
    billTo: meta.billTo,
    subscriptionId: meta.subscriptionId,
    usage: emptyUsage(),
    status: 'error',
    latencyMs: Date.now() - meta.startedAt,
    requestInput: meta.requestInput,
    sessionKeyHash: meta.sessionKeyHash,
    sessionSource: meta.sessionSource,
  })
  await reply.code(upstream.status).send({
    type: 'error',
    error: { type: code, code, message: redactUrls(message) },
  })
  await usageWrite
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
    let convertedStatus: 'error' | undefined
    let convertedHttpStatus: number | undefined
    if (upstream.ok) {
      const converted = provider.bufferSseResponse(sseText, meta)
      responseText = JSON.stringify(converted.body)
      usage = converted.usage
      responseContentType = 'application/json'
      convertedStatus = converted.status
      convertedHttpStatus = converted.httpStatus
    }
    const recorded = await recordUsage({
      apiKeyId: meta.apiKeyId,
      userId: meta.userId,
      accountId: meta.accountId,
      provider: meta.provider,
      model: meta.model,
      multiplier: meta.multiplier,
      billTo: meta.billTo,
      subscriptionId: meta.subscriptionId,
      usage,
      status: convertedStatus ?? (upstream.ok ? 'success' : 'error'),
      latencyMs: Date.now() - meta.startedAt,
      requestInput: meta.requestInput,
      sessionKeyHash: meta.sessionKeyHash,
      sessionSource: meta.sessionSource,
    })
    if (!recorded && upstream.ok && meta.userId) {
      await reply.code(503).send({ error: 'usage billing failed; response withheld' })
      return
    }
    await reply
      .code(convertedHttpStatus ?? upstream.status)
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
  const recorded = await recordUsage({
    apiKeyId: meta.apiKeyId,
    userId: meta.userId,
    accountId: meta.accountId,
    provider: meta.provider,
    model: meta.model,
    multiplier: meta.multiplier,
    billTo: meta.billTo,
    subscriptionId: meta.subscriptionId,
    usage,
    status: upstream.ok ? 'success' : 'error',
    latencyMs: Date.now() - meta.startedAt,
    requestInput: meta.requestInput,
    sessionKeyHash: meta.sessionKeyHash,
    sessionSource: meta.sessionSource,
  })
  if (!recorded && upstream.ok && meta.userId) {
    await reply.code(503).send({ error: 'usage billing failed; response withheld' })
    return
  }
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
 * Passthrough mode: parses each event for usage without rewriting, and records
 * any Responses-API terminal event (and its success/failure kind) into `state`.
 */
function feedSseBlock(
  block: string,
  parser: { feed(event: unknown): void },
  state: ResponsesStreamState,
): void {
  const dataLines: string[] = []
  for (const line of block.split('\n')) {
    const trimmed = line.trimStart()
    if (!trimmed.startsWith('data:')) continue
    dataLines.push(trimmed.slice(5).trimStart())
  }
  const payload = dataLines.join('\n').trim()
  if (!payload || payload === '[DONE]') return
  try {
    const parsed = JSON.parse(payload)
    parser.feed(parsed)
    noteResponsesTerminal(parsed, state)
  } catch {
    // Ignore non-JSON data blocks.
  }
}

/**
 * Stateful transform mode: parses each upstream `data:` JSON event, feeds it
 * to the stream transform, and writes each emitted event as its own SSE
 * frame. Non-data lines and `[DONE]` are dropped (the downstream protocol
 * has its own completion signal). Terminal events are recorded into `state`.
 */
function emitFromStreamTransform(
  raw: ServerResponse,
  block: string,
  xform: StreamTransform,
  parser: { feed(event: unknown): void },
  parseUpstream: boolean,
  onEmit: (() => void) | undefined,
  state: ResponsesStreamState,
): void {
  const dataLines: string[] = []
  for (const line of block.split('\n')) {
    const trimmed = line.trimStart()
    if (!trimmed.startsWith('data:')) continue
    dataLines.push(trimmed.slice(5).trimStart())
  }
  const payload = dataLines.join('\n').trim()
  if (!payload || payload === '[DONE]') return
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return
  }
  if (parseUpstream) parser.feed(parsed)
  for (const event of xform.transform(parsed)) {
    if (!parseUpstream && event !== '[DONE]') parser.feed(event)
    noteResponsesTerminal(event, state)
    onEmit?.()
    writeSseData(raw, event)
  }
}

function writeSseData(raw: ServerResponse, event: unknown): void {
  if (event === '[DONE]') {
    raw.write('data: [DONE]\n\n')
    return
  }
  if (
    event &&
    typeof event === 'object' &&
    (event as { __modelBridgeSseEvent?: unknown }).__modelBridgeSseEvent === true
  ) {
    const named = event as { event?: unknown; data?: unknown }
    if (typeof named.event === 'string' && named.event.trim()) {
      raw.write(`event: ${named.event.trim()}\n`)
    }
    raw.write(`data: ${JSON.stringify(named.data)}\n\n`)
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
