import { createHmac, timingSafeEqual } from 'node:crypto'
import { Readable } from 'node:stream'
import type { FastifyInstance, onSendAsyncHookHandler } from 'fastify'
import { config } from '../config'
import { fetchPublicMedia } from '../http/upstream'

type Kind = 'image' | 'video'
const FILE_ROUTE = '/api/media/v1/studio-file'
const TICKET_TTL_MS = 2 * 60 * 60_000
const MAX_URL_LENGTH = 4_096
const LIMITS = { image: 30 * 1024 ** 2, video: 256 * 1024 ** 2 }
const TYPES: Record<Kind, ReadonlySet<string>> = {
  image: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']),
  video: new Set(['video/mp4', 'video/webm', 'video/quicktime']),
}

function signature(payload: string): Buffer {
  return createHmac('sha256', config.JWT_SECRET).update('studio-file:v1:').update(payload).digest()
}

function studioFileUrl(url: string, kind: Kind): string {
  const expires = Date.now() + TICKET_TTL_MS
  const payload = Buffer.from(JSON.stringify({ url, kind, expires })).toString('base64url')
  return `${FILE_ROUTE}?ticket=${payload}.${signature(payload).toString('base64url')}`
}

/** Only the existing authenticated media result routes can issue file tickets. */
export function withStudioFiles(kind: Kind, field = kind === 'image' ? 'data' : 'results'): onSendAsyncHookHandler {
  return async (request, reply, payload) => {
    if (request.headers['x-model-bridge-studio'] !== '1' || !request.apiKey || reply.statusCode >= 300 ||
      !String(reply.getHeader('content-type')).startsWith('application/json') || typeof payload !== 'string') return payload

    let result
    try { result = JSON.parse(payload) } catch { return payload }
    if (!Array.isArray(result?.[field]) || result[field].length === 0) return payload
    for (const item of result[field]) {
      if (typeof item?.url === 'string' && item.url.length <= MAX_URL_LENGTH && /^https?:\/\//i.test(item.url)) {
        item.studio_url = studioFileUrl(item.url, kind)
      }
    }
    reply.header('Cache-Control', 'private, no-store')
    return JSON.stringify(result)
  }
}

function readTicket(ticket: string | undefined): { url: string; kind: Kind } | undefined {
  if (typeof ticket !== 'string' || !/^[\w-]{1,7500}\.[\w-]{43}$/.test(ticket)) return
  const [payload, digest] = ticket.split('.') as [string, string]
  const actual = Buffer.from(digest, 'base64url')
  if (!timingSafeEqual(actual, signature(payload))) return
  const { url, kind, expires } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  if (expires > Date.now() && (kind === 'image' || kind === 'video')) return { url, kind }
}

async function* boundedStream(body: NonNullable<Response['body']>, maxBytes: number) {
  let total = 0
  const stream = Readable.fromWeb(body)
  for await (const chunk of stream) {
    total += chunk.length
    if (total > maxBytes) throw new Error('Studio file exceeded the streaming limit')
    yield chunk
  }
}

export function registerStudioFileRoute(app: FastifyInstance): void {
  app.get<{ Querystring: { ticket?: string; download?: string } }>(FILE_ROUTE, { logLevel: 'warn' }, async (request, reply) => {
    const media = readTicket(request.query.ticket)
    reply.header('Cache-Control', 'private, no-store')
    if (!media) return reply.code(404).send({ error: '文件链接无效或已过期' })

    const controller = new AbortController()
    reply.raw.once('close', () => controller.abort())
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)])
    const range = request.headers.range
    if (range && !/^bytes=(?:\d{1,12}-\d{0,12}|-\d{1,12})$/.test(range)) return reply.code(416).send()

    let response: Response
    try {
      response = await fetchPublicMedia(media.url, signal, range)
    } catch {
      return reply.code(502).send({ error: '暂时无法读取生成的文件' })
    }
    const type = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
    const length = response.headers.get('content-length')
    if (response.status === 416) {
      await response.body?.cancel()
      const contentRange = response.headers.get('content-range')
      if (contentRange) reply.header('Content-Range', contentRange)
      return reply.code(416).send()
    }
    if (![200, 206].includes(response.status) || !response.body || !TYPES[media.kind].has(type) ||
      (length && Number(length) > LIMITS[media.kind])) {
      await response.body?.cancel()
      return reply.code(502).send({ error: '无法预览或下载文件，原始链接可能已过期' })
    }

    for (const header of ['content-range', 'accept-ranges']) {
      const value = response.headers.get(header)
      if (value) reply.header(header, value)
    }
    if (length && !response.headers.has('content-encoding')) reply.header('Content-Length', length)
    reply.header('Cross-Origin-Resource-Policy', 'same-origin')
    reply.header('X-Content-Type-Options', 'nosniff')
    if (request.query.download === '1') {
      const extension = type === 'video/quicktime' ? 'mov' : type.split('/')[1]
      reply.header('Content-Disposition', `attachment; filename="model-bridge.${extension}"`)
    }
    return reply.code(response.status).type(type).send(Readable.from(boundedStream(response.body, LIMITS[media.kind])))
  })
}
