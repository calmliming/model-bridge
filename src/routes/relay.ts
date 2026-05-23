import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { requireApiKey } from '../middleware/apiKeyAuth'
import { ensureFreshToken } from '../accounts/manager'
import { markAccountUsed, penalizeAccount, pickAccount } from '../accounts/scheduler'
import { relayClaudeMessages } from '../providers/claude/relay'
import * as claudeUsage from '../providers/claude/usage'
import { relayOpenaiResponses } from '../providers/openai/relay'
import * as openaiUsage from '../providers/openai/usage'
import { recordUsage } from '../usage/recorder'
import { emptyUsage, type UsageData } from '../providers/types'

/** Max upstream accounts to try before giving up on a request. */
const MAX_ATTEMPTS = 3

interface ProviderHandler {
  id: string
  /** Always treat the upstream response as SSE (some providers force `stream:true`). */
  forceStream: boolean
  callUpstream(token: string, body: Record<string, unknown>): Promise<Response>
  createStreamParser(): { feed(event: unknown): void; result(): UsageData }
  parseJsonUsage(body: unknown): UsageData
}

const PROVIDERS: Record<string, ProviderHandler> = {
  claude: {
    id: 'claude',
    forceStream: false,
    callUpstream: relayClaudeMessages,
    createStreamParser: claudeUsage.createStreamParser,
    parseJsonUsage: claudeUsage.parseJsonUsage,
  },
  openai: {
    id: 'openai',
    forceStream: true, // the Codex backend itself rejects non-streaming.
    callUpstream: relayOpenaiResponses,
    createStreamParser: openaiUsage.createStreamParser,
    parseJsonUsage: openaiUsage.parseJsonUsage,
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
  // Claude Code → Anthropic Messages API
  app.post('/api/claude/v1/messages', { preHandler: requireApiKey }, (request, reply) =>
    executeRelay(request, reply, PROVIDERS.claude!),
  )
  // Codex CLI → Codex backend Responses API
  app.post('/api/openai/v1/responses', { preHandler: requireApiKey }, (request, reply) =>
    executeRelay(request, reply, PROVIDERS.openai!),
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
  const wantStream = provider.forceStream || body.stream === true
  const model = typeof body.model === 'string' ? body.model : ''
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
      upstream = await provider.callUpstream(token, body)
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
      model,
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

/** Streams an SSE response straight through while teeing token usage. */
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
  let buffer = ''

  if (upstream.body) {
    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        raw.write(Buffer.from(value))
        buffer += decoder.decode(value, { stream: true })
        let sep: number
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          feedSseBlock(buffer.slice(0, sep), parser)
          buffer = buffer.slice(sep + 2)
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

/** Buffers a non-streaming response, forwards it, and records usage. */
async function sendBuffered(
  reply: FastifyReply,
  upstream: Response,
  meta: RelayMeta,
  provider: ProviderHandler,
): Promise<void> {
  const text = await upstream.text()
  let usage: UsageData = emptyUsage()
  try {
    usage = provider.parseJsonUsage(JSON.parse(text))
  } catch {
    // Error responses are not valid usage JSON — leave usage empty.
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

/** Parses the `data:` JSON from one SSE event block and feeds the usage parser. */
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
