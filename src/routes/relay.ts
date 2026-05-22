import type { FastifyInstance, FastifyReply } from 'fastify'
import { requireApiKey } from '../middleware/apiKeyAuth'
import { ensureFreshToken } from '../accounts/manager'
import { markAccountUsed, penalizeAccount, pickAccount } from '../accounts/scheduler'
import { relayClaudeMessages } from '../providers/claude/relay'
import { createStreamUsageParser, parseUsageFromJson } from '../providers/claude/usage'
import { recordUsage } from '../usage/recorder'
import { emptyUsage, type UsageData } from '../providers/types'

/** Max upstream accounts to try before giving up on a request. */
const MAX_ATTEMPTS = 3

interface RelayMeta {
  apiKeyId: string
  accountId: string
  provider: string
  model: string
  startedAt: number
}

/** Registers the provider relay endpoints. Claude only for now. */
export function registerRelayRoutes(app: FastifyInstance): void {
  app.post('/api/claude/v1/messages', { preHandler: requireApiKey }, async (request, reply) => {
    const apiKey = request.apiKey!
    if (apiKey.allowedProviders && !apiKey.allowedProviders.includes('claude')) {
      return reply.code(403).send({ error: 'this API key may not use Claude' })
    }

    const body = (request.body ?? {}) as Record<string, unknown>
    const wantStream = body.stream === true
    const model = typeof body.model === 'string' ? body.model : ''
    const tried: string[] = []

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const account = pickAccount('claude', tried)
      if (!account) {
        return reply
          .code(503)
          .send({ error: tried.length ? 'all Claude accounts are unavailable' : 'no Claude account configured' })
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
        upstream = await relayClaudeMessages(token, body)
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
        // Retries exhausted — penalize but still forward the error to the client.
        penalizeAccount(account.id, upstream.status === 429 ? 'rate_limited' : 'error')
      } else {
        markAccountUsed(account.id)
      }

      const meta: RelayMeta = {
        apiKeyId: apiKey.id,
        accountId: account.id,
        provider: 'claude',
        model,
        startedAt,
      }
      return wantStream ? sendStreaming(reply, upstream, meta) : sendBuffered(reply, upstream, meta)
    }

    return reply.code(503).send({ error: 'all Claude accounts failed' })
  })
}

/** Streams an SSE response straight through while teeing token usage. */
async function sendStreaming(
  reply: FastifyReply,
  upstream: Response,
  meta: RelayMeta,
): Promise<void> {
  reply.hijack()
  const raw = reply.raw
  raw.writeHead(upstream.status, {
    'content-type': upstream.headers.get('content-type') ?? 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })

  const parser = createStreamUsageParser()
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
): Promise<void> {
  const text = await upstream.text()
  let usage: UsageData = emptyUsage()
  try {
    usage = parseUsageFromJson(JSON.parse(text))
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
  reply
    .code(upstream.status)
    .header('content-type', upstream.headers.get('content-type') ?? 'application/json')
    .send(text)
}

/** Parses the `data:` JSON from one SSE event block and feeds the usage parser. */
function feedSseBlock(block: string, parser: ReturnType<typeof createStreamUsageParser>): void {
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
