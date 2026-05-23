import type { ServerResponse } from 'node:http'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { requireApiKey } from '../middleware/apiKeyAuth'
import { ensureFreshToken } from '../accounts/manager'
import { markAccountUsed, penalizeAccount, pickAccount } from '../accounts/scheduler'
import { relayClaudeMessages } from '../providers/claude/relay'
import * as claudeUsage from '../providers/claude/usage'
import { relayOpenaiResponses } from '../providers/openai/relay'
import * as openaiUsage from '../providers/openai/usage'
import { relayGemini, unwrapResponseEnvelope } from '../providers/gemini/relay'
import * as geminiUsage from '../providers/gemini/usage'
import { recordUsage } from '../usage/recorder'
import { emptyUsage, type UsageData } from '../providers/types'

/** Max upstream accounts to try before giving up on a request. */
const MAX_ATTEMPTS = 3

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

interface ProviderHandler {
  id: string
  /** Always stream the response regardless of the client's stream flag (Codex backend). */
  forceStream: boolean
  parseRoute(request: FastifyRequest, body: Record<string, unknown>): ParsedRoute
  callUpstream(
    token: string,
    body: Record<string, unknown>,
    ctx: UpstreamContext,
  ): Promise<Response>
  createStreamParser(): { feed(event: unknown): void; result(): UsageData }
  parseJsonUsage(body: unknown): UsageData
  /** Optional payload transform applied to each SSE event / buffered JSON body. */
  transformEventData?: (data: unknown) => unknown
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
    parseRoute: (_req, body) => ({
      model: typeof body.model === 'string' ? body.model : '',
      action: 'responses',
    }),
    callUpstream: (token, body, _ctx) => relayOpenaiResponses(token, body),
    createStreamParser: openaiUsage.createStreamParser,
    parseJsonUsage: openaiUsage.parseJsonUsage,
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
}

interface RelayMeta {
  apiKeyId: string
  accountId: string
  provider: string
  model: string
  startedAt: number
}

/** Registers the provider relay endpoints. */
export function registerRelayRoutes(app: FastifyInstance): void {
  app.post('/api/claude/v1/messages', { preHandler: requireApiKey }, (request, reply) =>
    executeRelay(request, reply, PROVIDERS.claude!),
  )
  app.post('/api/openai/v1/responses', { preHandler: requireApiKey }, (request, reply) =>
    executeRelay(request, reply, PROVIDERS.openai!),
  )
  // Gemini API surface: /v1beta/models/{model}:{action}. The wildcard
  // captures `{model}:{action}` in a single segment.
  app.post('/api/gemini/v1beta/models/*', { preHandler: requireApiKey }, (request, reply) =>
    executeRelay(request, reply, PROVIDERS.gemini!),
  )
}

/** Provider-generic relay loop: pick → call upstream → retry → stream/buffer. */
async function executeRelay(
  request: FastifyRequest,
  reply: FastifyReply,
  provider: ProviderHandler,
): Promise<void> {
  const apiKey = request.apiKey!
  if (apiKey.allowedProviders && !apiKey.allowedProviders.includes(provider.id)) {
    await reply.code(403).send({ error: `this API key may not use ${provider.id}` })
    return
  }

  const body = (request.body ?? {}) as Record<string, unknown>
  const parsed = provider.parseRoute(request, body)
  const wantStream =
    provider.forceStream || body.stream === true || parsed.action === 'streamGenerateContent'
  const tried: string[] = []

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const account = pickAccount(provider.id, tried)
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
      penalizeAccount(account.id, 'error')
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
      penalizeAccount(account.id, 'error')
      continue
    }

    const retryable =
      upstream.status === 429 || upstream.status === 401 || upstream.status >= 500
    const lastAttempt = attempt === MAX_ATTEMPTS - 1

    if (retryable && !lastAttempt) {
      penalizeAccount(account.id, upstream.status === 429 ? 'rate_limited' : 'error')
      await upstream.body?.cancel().catch(() => {})
      continue
    }

    if (retryable) {
      penalizeAccount(account.id, upstream.status === 429 ? 'rate_limited' : 'error')
    } else {
      markAccountUsed(account.id)
    }

    const meta: RelayMeta = {
      apiKeyId: apiKey.id,
      accountId: account.id,
      provider: provider.id,
      model: parsed.model,
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
 * Streams an SSE response back. Without `transformEventData` it's a raw
 * byte passthrough with a side-channel parse for usage. With a transform
 * (Gemini) it parses each event, rewrites the payload, and re-emits.
 */
async function sendStreaming(
  reply: FastifyReply,
  upstream: Response,
  meta: RelayMeta,
  provider: ProviderHandler,
): Promise<void> {
  reply.hijack()
  const raw = reply.raw
  raw.writeHead(upstream.status, {
    'content-type': upstream.headers.get('content-type') ?? 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })

  const parser = provider.createStreamParser()
  const transform = provider.transformEventData
  let buffer = ''

  if (upstream.body) {
    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        if (transform) {
          // Event-buffered: only emit complete events, rewriting payloads.
          let sep: number
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            rewriteAndEmit(raw, buffer.slice(0, sep), transform, parser)
            buffer = buffer.slice(sep + 2)
          }
        } else {
          // Raw passthrough; side-channel parse for usage.
          raw.write(Buffer.from(value))
          let sep: number
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            feedSseBlock(buffer.slice(0, sep), parser)
            buffer = buffer.slice(sep + 2)
          }
        }
      }
    } catch {
      // Client disconnected or upstream aborted — stop quietly.
    }
  }
  raw.end()

  recordUsage({
    apiKeyId: meta.apiKeyId,
    accountId: meta.accountId,
    provider: meta.provider,
    model: meta.model,
    usage: parser.result(),
    status: upstream.ok ? 'success' : 'error',
    latencyMs: Date.now() - meta.startedAt,
  })
}

/** Buffers a non-streaming response, optionally rewriting the JSON body, and records usage. */
async function sendBuffered(
  reply: FastifyReply,
  upstream: Response,
  meta: RelayMeta,
  provider: ProviderHandler,
): Promise<void> {
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
  recordUsage({
    apiKeyId: meta.apiKeyId,
    accountId: meta.accountId,
    provider: meta.provider,
    model: meta.model,
    usage,
    status: upstream.ok ? 'success' : 'error',
    latencyMs: Date.now() - meta.startedAt,
  })
  await reply
    .code(upstream.status)
    .header('content-type', upstream.headers.get('content-type') ?? 'application/json')
    .send(text)
}

/** Passthrough mode: parses each event for usage without rewriting. */
function feedSseBlock(block: string, parser: { feed(event: unknown): void }): void {
  for (const line of block.split('\n')) {
    const trimmed = line.trimStart()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      parser.feed(JSON.parse(payload))
    } catch {
      // Ignore non-JSON data lines.
    }
  }
}

/** Transform mode: parses each event, applies transform, re-emits SSE. */
function rewriteAndEmit(
  raw: ServerResponse,
  block: string,
  transform: (data: unknown) => unknown,
  parser: { feed(event: unknown): void },
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
  raw.write(out.join('\n') + '\n\n')
}
