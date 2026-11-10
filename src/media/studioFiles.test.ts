import Fastify from 'fastify'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPublicMedia } from '../http/upstream'
import type { AuthedApiKey } from '../middleware/apiKeyAuth'
import { registerStudioFileRoute, withStudioFiles } from './studioFiles'

vi.mock('../http/upstream', () => ({ fetchPublicMedia: vi.fn() }))

const app = Fastify()
registerStudioFileRoute(app)
const upstream = 'https://files.example.com/creation.mp4'
app.get('/result', {
  preHandler: async request => { request.apiKey = {} as AuthedApiKey },
  onSend: withStudioFiles('video'),
}, () => ({ status: 'succeeded', results: [{ url: upstream }] }))

afterAll(() => app.close())

afterEach(() => {
  vi.resetAllMocks()
  vi.restoreAllMocks()
})

async function signedFile(): Promise<string> {
  const response = await app.inject({ url: '/result', headers: { 'x-model-bridge-studio': '1' } })
  expect(response.headers['cache-control']).toBe('private, no-store')
  const [result] = response.json().results
  expect(result.url).toBe(upstream)
  expect(result.studio_url).toMatch(/^\/api\/media\/v1\/studio-file\?ticket=/)
  return result.studio_url
}

describe('creation studio media files', () => {
  it('adds a temporary file URL only for studio requests and streams video ranges', async () => {
    expect((await app.inject('/result')).json().results).toEqual([{ url: upstream }])
    const url = await signedFile()
    vi.mocked(fetchPublicMedia).mockResolvedValueOnce(new Response('mp4', {
      status: 206,
      headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-2/12', 'content-length': '3' },
    }))
    const file = await app.inject({ url, headers: { range: 'bytes=0-2' } })
    expect(fetchPublicMedia).toHaveBeenCalledWith(upstream, expect.any(AbortSignal), 'bytes=0-2')
    expect(file.statusCode).toBe(206)
    expect(file.headers['content-range']).toBe('bytes 0-2/12')
    expect(file.body).toBe('mp4')
  })

  it('rejects tampered and expired tickets before downloading anything', async () => {
    const url = await signedFile()
    expect((await app.inject(url.replace(/\.(.)/, (_, first) => first === 'a' ? '.b' : '.a'))).statusCode).toBe(404)
    const expires = Date.now() + 2 * 60 * 60_000 + 1
    vi.spyOn(Date, 'now').mockReturnValue(expires)
    expect((await app.inject(url)).statusCode).toBe(404)
    expect(fetchPublicMedia).not.toHaveBeenCalled()
  })

  it('rejects non-media responses and serves downloads as attachments', async () => {
    const url = await signedFile()
    vi.mocked(fetchPublicMedia).mockResolvedValueOnce(new Response('<html></html>', { headers: { 'content-type': 'text/html' } }))
    expect((await app.inject(url)).statusCode).toBe(502)
    vi.mocked(fetchPublicMedia).mockResolvedValueOnce(new Response('video', { headers: { 'content-type': 'video/mp4' } }))
    const download = await app.inject(`${url}&download=1`)
    expect(download.statusCode).toBe(200)
    expect(download.headers['content-disposition']).toBe('attachment; filename="model-bridge.mp4"')
  })
})
