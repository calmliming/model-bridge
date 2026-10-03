import { z } from 'zod'
import { assertSafeUpstreamUrl } from '../../http/urlGuard'
import { fetchWithConnectTimeout } from '../../http/upstream'
import { redactUpstreamError } from '../../http/upstreamDiagnostics'
import { ProviderRequestError } from '../requestError'
import { GRSAI_MODELS } from './models'
import { publicMediaError } from '../publicIdentity'

export function grsaiBaseUrl(value?: string | null): string {
  const raw = value?.trim() || 'https://grsai.dakka.com.cn'
  const url = assertSafeUpstreamUrl(raw)
  if (url.search || url.hash) throw new Error('GrsAI Base URL must not contain query parameters or a fragment')
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/v1(?:\/api)?$/, '')
  return url.toString().replace(/\/+$/, '')
}

const reference = z.string().trim().min(1).refine(value => /^https?:\/\//i.test(value) || /^data:(?:image|audio)\/[\w.+-]+;base64,/i.test(value), 'references must be HTTP(S) URLs or base64 data URLs')
const generateSchema = z.object({
  model: z.string().refine(model => GRSAI_MODELS.includes(model), 'unsupported image or video model'),
  prompt: z.string().min(1).max(100_000).refine(value => !!value.trim(), 'prompt is required'),
  images: z.array(reference).max(9).optional(), audios: z.array(reference).max(3).optional(),
  aspectRatio: z.string().optional(), quality: z.string().optional(),
  background: z.enum(['auto', 'opaque', 'transparent']).optional(), mask: reference.optional(),
  resolution: z.enum(['480p', '768p', '1080p']).optional(),
  duration: z.number().int().min(1).max(15).optional(), seed: z.number().int().safe().optional(),
  replyType: z.enum(['json', 'stream', 'async']).optional(),
}).strict()
export type GrsaiGenerateRequest = z.infer<typeof generateSchema>

/** Validate before scheduling, so invalid requests never call a paid endpoint. */
export function parseGrsaiGenerateRequest(raw: unknown): GrsaiGenerateRequest {
  const parsed = generateSchema.safeParse(raw)
  if (!parsed.success) throw new ProviderRequestError('invalid_media_request', parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '))
  const body = parsed.data
  const invalid = (message: string): never => { throw new ProviderRequestError('invalid_media_request', message) }
  if (body.model === 'minimax-h3') {
    if (!['portrait', 'landscape'].includes(body.aspectRatio ?? '')) invalid('aspectRatio must be portrait or landscape')
    if (!body.resolution || !body.duration) invalid('resolution and duration are required for minimax-h3')
    if (body.resolution === '1080p' && body.duration! > 10) invalid('1080p supports at most 10 seconds')
    if (body.quality || body.background || body.mask) invalid('quality, background and mask are image-only parameters')
  } else {
    if (body.audios || body.resolution || body.duration || body.seed != null) invalid('audios, resolution, duration and seed are video-only parameters')
    const basic = ['gpt-image-2', 'gpt-image-2.5'].includes(body.model)
    const allowedQuality = basic ? ['auto'] : body.model === 'gpt-image-2-vip' ? ['medium']
      : body.model.endsWith('-flare') ? ['low', 'medium', 'high'] : ['low', 'medium', 'high', 'xhigh', 'max']
    if (body.quality && !allowedQuality.includes(body.quality)) invalid(`quality for ${body.model} must be ${allowedQuality.join(', ')}`)
    if (body.background === 'transparent' && basic) invalid(`${body.model} does not support transparent backgrounds`)
    const size = body.aspectRatio || 'auto'
    if (size !== 'auto') {
      const ratio = size.match(/^(\d+):(\d+)$/)
      const pixels = size.match(/^(\d+)x(\d+)$/)
      if (ratio && basic) {
        const value = Number(ratio[1]) / Number(ratio[2])
        if (!Number(ratio[1]) || !Number(ratio[2]) || value > 3 || value < 1 / 3) invalid('image aspect ratio must be between 1:3 and 3:1')
      } else if (pixels) {
        const width = Number(pixels[1]), height = Number(pixels[2])
        if (!width || !height || Math.max(width, height) > 3840 || Math.max(width, height) / Math.min(width, height) > 3
          || width * height < 655_360 || width * height > 8_294_400
          || (!basic && (width % 16 !== 0 || height % 16 !== 0))) invalid('invalid image dimensions')
        if (basic && width * height > 2_097_152) invalid(`${body.model} only supports 1K images; use a VIP, Flare or Sunburst model for 2K/4K`)
      } else invalid(basic ? 'aspectRatio must be auto, W:H or WIDTHxHEIGHT' : 'aspectRatio must be auto or WIDTHxHEIGHT')
    }
  }
  return body
}

export interface GrsaiResult {
  id: string
  status: 'running' | 'succeeded' | 'failed' | 'violation'
  progress: number
  results: Array<{ url: string }>
  error?: string
}
export class GrsaiUpstreamError extends Error {
  constructor(readonly statusCode: number, message: string) { super(publicMediaError(message)) }
}

export async function boundedBody(response: Response, limit = 2 * 1024 * 1024): Promise<Buffer> {
  if (!response.body) throw new GrsaiUpstreamError(502, 'GrsAI returned an empty response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) { await reader.cancel(); throw new GrsaiUpstreamError(502, 'GrsAI response exceeds the size limit') }
      chunks.push(value)
    }
    return Buffer.concat(chunks)
  } finally { reader.releaseLock() }
}

export function parseGrsaiResult(raw: unknown): GrsaiResult {
  const parsed = z.object({ id: z.string().regex(/^[\w-]{1,200}$/),
    status: z.enum(['running', 'succeeded', 'failed', 'violation']),
    progress: z.number().min(0).max(100).optional(),
    results: z.array(z.object({ url: z.string().url().refine(url => /^https?:\/\//i.test(url)) })).max(10).optional(),
    error: z.string().optional(),
  }).safeParse(raw)
  if (!parsed.success) throw new GrsaiUpstreamError(502, 'GrsAI returned an invalid task result')
  const result = parsed.data
  if (result.status === 'succeeded' && !result.results?.length) throw new GrsaiUpstreamError(502, 'GrsAI completed without media output')
  return { ...result, progress: result.progress ?? (result.status === 'succeeded' ? 100 : 0), results: result.results ?? [],
    ...(result.error ? { error: publicMediaError(result.error) } : {}) }
}

async function readResult(response: Response): Promise<GrsaiResult> {
  let raw: unknown
  try { raw = JSON.parse((await boundedBody(response)).toString('utf8')) }
  catch (error) { if (error instanceof GrsaiUpstreamError) throw error; throw new GrsaiUpstreamError(502, 'GrsAI returned invalid JSON') }
  // Generation failures may use HTTP 400 and still return a valid terminal task.
  if (response.ok || (raw && typeof raw === 'object' && ['failed', 'violation'].includes((raw as { status: string }).status))) return parseGrsaiResult(raw)
  const message = (raw as { error?: { message?: string } | string; msg?: string } | null)?.error
  throw new GrsaiUpstreamError(response.status, typeof message === 'string' ? message : message?.message || `GrsAI returned HTTP ${response.status}`)
}

export async function generateGrsai(token: string, body: GrsaiGenerateRequest, baseUrl?: string | null): Promise<GrsaiResult> {
  const timeout = body.replyType === 'async' ? 30_000 : 600_000
  return readResult(await fetchWithConnectTimeout(`${grsaiBaseUrl(baseUrl)}/v1/api/generate`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeout),
  }, timeout))
}

export async function queryGrsaiResult(token: string, id: string, baseUrl?: string | null): Promise<GrsaiResult> {
  const result = await readResult(await fetchWithConnectTimeout(`${grsaiBaseUrl(baseUrl)}/v1/api/result?id=${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
  }))
  if (result.id !== id) throw new GrsaiUpstreamError(502, 'GrsAI returned a different task ID')
  return result
}

/** A non-generating query checks authentication without consuming generation credits. */
export async function testGrsai(token: string, baseUrl?: string | null): Promise<void> {
  const response = await fetchWithConnectTimeout(`${grsaiBaseUrl(baseUrl)}/v1/api/result?id=model-bridge-connectivity-probe`, {
    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
  })
  const text = (await boundedBody(response)).toString('utf8')
  if ([401, 403].includes(response.status)) throw new Error('GrsAI API Key 无效或权限不足')
  if (response.status >= 500) throw new Error(`GrsAI 返回 HTTP ${response.status}`)
  // Only an authenticated missing-task response proves connectivity.
  if (!/not found|not exist|不存在|任务未找到|找不到/i.test(text)) throw new Error('GrsAI 连通性尚未确认，请检查 API Key 和 Base URL')
}
