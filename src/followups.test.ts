import { afterEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { config } from './config'
import { emptyUsage } from './providers/types'
import { estimateCost, resolvePrice, resolveUsagePrice } from './usage/pricing'
import { parseJsonUsage as deepseekUsage } from './providers/deepseek/responses-usage'
import { parseOpenAIUsagePayload } from './providers/openai/usage'
import { parseJsonUsage as geminiUsage, createStreamParser as geminiStream } from './providers/gemini/usage'
import { normalizeGrokResponsesBody } from './providers/grok/relay'
import { antigravityStreamStartVerdict } from './providers/antigravity/response'
import { neutralizeSystemIdentity } from './providers/antigravity/identity'
import { bodyHasSseFraming, readBoundedText, readWithDeadline, SseBudget } from './http/bodyLimits'
import { registerIngressMemory, ingressMemoryBytes, releaseIngressMemory, retainIngressUntilSettled } from './http/ingressMemory'
import { accountUpstreamMemory, upstreamMemoryBytes, withUpstreamMemory } from './http/upstreamMemory'
import { isCNFrequencyLimit } from './providers/cnRateLimit'
import { accountAllowsImageTier, imageSizeTier } from './providers/openai/imageSizeTiers'
import { ipAllowed, validIpRule } from './management/permissions'
import { mailboxIdentity } from './users/emailBlacklist'
import { WriteExecutor } from './usage/writeExecutor'
import { normalizeTerraRequest } from './providers/openai/models'
import { fetchCodexManifest } from './providers/openai/codexCatalog'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('follow-up billing and compatibility regressions', () => {
  it.each(['gpt-6.1-terra', 'gpt-6-1-terra', 'gpt-6.1-terra-high'])('uses dedicated Terra rates for %s', model => {
    expect(resolvePrice('openai', model)).toEqual({ input: 1, output: 5, cacheRead: 0.05, cacheWrite: 1.25 })
    expect(resolveUsagePrice('sub2api', model, { ...emptyUsage(), inputTokens: 300000, serviceTier: 'priority' })).toMatchObject({ input: 4, output: 15, cacheRead: 0.2 })
  })
  it('preserves explicit zero cache counts and splits compatible Responses cache hits once', () => {
    const usage = { input_tokens: 1000, output_tokens: 10, prompt_cache_hit_tokens: 800 }
    for (const actual of [deepseekUsage({ usage }), parseOpenAIUsagePayload(usage)]) expect(actual).toMatchObject({ inputTokens: 200, cacheReadTokens: 800 })
    expect(parseOpenAIUsagePayload({ ...usage, input_tokens_details: { cached_tokens: 0 } })).toMatchObject({ inputTokens: 1000, cacheReadTokens: 0 })
  })
  it('normalizes Terra effort aliases without silently overriding explicit effort', () => {
    expect(normalizeTerraRequest({ model: 'gpt-6.1-terra-none', input: 'hi', temperature: 0.5 })).toMatchObject({ model: 'gpt-6.1-terra', reasoning: { effort: 'none' }, temperature: 0.5 })
    expect(normalizeTerraRequest({ model: 'gpt-6-1-terra-high', input: 'hi', temperature: 0.5 })).not.toHaveProperty('temperature')
    expect(() => normalizeTerraRequest({ model: 'gpt-6.1-terra-high', reasoning: { effort: 'none' } })).toThrow('disagree')
  })
  it('splits Gemini image tokens and counts repeated fileData output only once', () => {
    const event = { candidates: [{ content: { parts: [{ fileData: { mimeType: 'image/png', fileUri: 'https://example.invalid/one' } }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 100, thoughtsTokenCount: 2, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 80 }] } }
    expect(geminiUsage(event)).toMatchObject({ inputTokens: 10, outputTokens: 22, imageOutputTokens: 80, imageCount: 1 })
    const parser = geminiStream(); parser.feed(event); parser.feed(event)
    expect(parser.result()).toMatchObject({ outputTokens: 22, imageOutputTokens: 80, imageCount: 1 })
    expect(estimateCost('gemini', 'gemini-3.1-flash-lite-image', { ...emptyUsage(), imageOutputTokens: 1_000_000 })).toBe(30)
  })
  it('retains complete delegated task content for Grok in original order', () => {
    const body = normalizeGrokResponsesBody({ input: [{ type: 'agent_message', content: [{ type: 'input_text', text: 'Task: ' }, { type: 'encrypted_content', encrypted_content: 'check gateway\n' }] }] })
    expect(body.input).toEqual([{ type: 'message', role: 'user', content: 'Task: check gateway\n' }])
  })
  it('retries malformed tool structures but accepts omitted arguments', () => {
    const event = (call: unknown) => ({ candidates: [{ content: { parts: [{ functionCall: call }] } }] })
    expect(antigravityStreamStartVerdict(event({ name: 42, args: {} }))).toEqual({ retry: 'MALFORMED_FUNCTION_CALL' })
    expect(antigravityStreamStartVerdict(event({ name: 'clock' }))).toBe('pass')
  })
  it('only neutralizes leading vendor declarations and preserves the task', () => {
    expect(neutralizeSystemIdentity('You are GPT-6, an AI model developed by OpenAI. Keep the task.')).toBe('You are an AI assistant. Keep the task.')
    expect(neutralizeSystemIdentity('Explain what OpenAI does.')).toBe('Explain what OpenAI does.')
    expect(neutralizeSystemIdentity('x-anthropic-billing-header: fixture\nYou are Claude. Keep the task.')).toBe('You are an AI assistant. Keep the task.')
    expect(neutralizeSystemIdentity('attribution: cite sources')).toBe('attribution: cite sources')
    expect(neutralizeSystemIdentity('You are Claude, a specialist reviewing systems created by OpenAI. Keep the task.')).toBe('You are an AI assistant, a specialist reviewing systems created by OpenAI. Keep the task.')
  })
  it('recognizes precise Kimi limits without classifying permission or quota errors as frequency', () => {
    const message = "You've reached your concurrent request limit. Please wait for your ongoing requests to finish and try again."
    expect(isCNFrequencyLimit('kimi', 403, JSON.stringify({ error: { message } }))).toBe(true)
    expect(isCNFrequencyLimit('openai', 403, message)).toBe(false)
    expect(isCNFrequencyLimit('kimi', 403, 'Concurrent request permission denied')).toBe(false)
    expect(isCNFrequencyLimit('qwen', 429, 'rate limit exceeded; insufficient_balance')).toBe(false)
  })
  it('uses actual image dimensions and keeps unrestricted accounts eligible', () => {
    expect(imageSizeTier('1024x1024')).toBe('1K'); expect(imageSizeTier('1536x1024')).toBe('2K'); expect(imageSizeTier('2560x1440')).toBe('4K')
    expect(imageSizeTier('auto')).toBeNull(); expect(accountAllowsImageTier({}, '4K')).toBe(true)
    expect(accountAllowsImageTier({ imageSizeTiers: ['1K'] }, '4K')).toBe(false)
  })
  it('coalesces cold Codex catalog reads while isolating different accounts', async () => {
    const fetcher = vi.fn(async () => { await new Promise(resolve => setTimeout(resolve, 10)); return Response.json({ models: [{ slug: 'fixture-model' }] }) })
    vi.stubGlobal('fetch', fetcher)
    const input = { accountId: 'followup-fixture-catalog', token: 'fixture-token', clientVersion: '0.156.0' }
    const [first, second] = await Promise.all([fetchCodexManifest(input), fetchCodexManifest(input)])
    expect(first).toEqual(second); expect(fetcher).toHaveBeenCalledOnce()
    await fetchCodexManifest(input); expect(fetcher).toHaveBeenCalledOnce()
    await fetchCodexManifest({ ...input, accountId: 'separate-fixture-account' }); expect(fetcher).toHaveBeenCalledTimes(2)
  })
})

describe('bounded gateway resources', () => {
  it('limits unfinished frames and multi-line events while allowing long sequences of valid frames', () => {
    expect(() => new SseBudget(10, 10).feed('data:123456789')).toThrow('limit')
    expect(() => new SseBudget(1000, 2).feed('data:1\ndata:2\ndata:3\n')).toThrow('limit')
    const budget = new SseBudget(100, 2)
    for (let i = 0; i < 1000; i++) budget.feed('data: {}\n\n')
  })
  it('enforces a byte limit while consuming unknown-length non-stream bodies', async () => {
    let cancelled = false
    const response = new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(8)) }, cancel() { cancelled = true } }))
    await expect(readBoundedText(response, 10)).rejects.toMatchObject({ code: 'response_too_large' })
    expect(cancelled).toBe(true)
  })
  it('times out an idle read and cancels the reader without a stream lifetime timer', async () => {
    vi.useFakeTimers()
    let cancelled = false
    const reader = new ReadableStream({ cancel() { cancelled = true } }).getReader()
    const pending = readWithDeadline(reader, 100).catch(error => error)
    await vi.advanceTimersByTimeAsync(101)
    expect(await pending).toMatchObject({ code: 'upstream_idle_timeout' })
    expect(cancelled).toBe(true)
    reader.releaseLock()
  })
  it('recognizes SSE framing only at the beginning and rejects JSON and unrelated data prose', () => {
    expect(bodyHasSseFraming('event: response.completed\ndata: {"type":"response.completed"}\n\n')).toBe(true)
    expect(bodyHasSseFraming('{"text":"data: {}"}')).toBe(false)
    expect(bodyHasSseFraming('Here is data:\ndata: {}')).toBe(false)
  })
  it('releases ingress reservations after a successful upload', async () => {
    const app = Fastify(); registerIngressMemory(app)
    app.post('/test', async () => ({ held: ingressMemoryBytes() }))
    try { const response = await app.inject({ method: 'POST', url: '/test', payload: { text: 'hello' } }); expect(response.statusCode).toBe(200); expect(response.json().held).toBeGreaterThan(0); expect(ingressMemoryBytes()).toBe(0) }
    finally { await app.close() }
  })
  it('rejects budget overflow before the route executes and returns the reservation', async () => {
    const previous = config.INGRESS_MEMORY_MAX_BYTES
    config.INGRESS_MEMORY_MAX_BYTES = 128 * 1024 + 500
    const app = Fastify(); registerIngressMemory(app)
    let resume!: () => void
    const gate = new Promise<void>(resolve => { resume = resolve })
    const route = vi.fn(async () => { await gate; return 'ok' }); app.post('/test', route)
    const first = app.inject({ method: 'POST', url: '/test', payload: 'x'.repeat(128), headers: { 'content-type': 'text/plain' } }).then(result => result)
    try {
      await vi.waitFor(() => expect(route).toHaveBeenCalledOnce())
      const response = await app.inject({ method: 'POST', url: '/test', payload: 'x'.repeat(100), headers: { 'content-type': 'text/plain' } })
      expect(response.statusCode).toBe(503); expect(route).toHaveBeenCalledOnce(); expect(response.headers['retry-after']).toBe('5')
      resume(); expect((await first).statusCode).toBe(200); expect(ingressMemoryBytes()).toBe(0)
    }
    finally { config.INGRESS_MEMORY_MAX_BYTES = previous; await app.close() }
  })
  it('retains upload ownership after a hijacked response until explicit settlement completes', async () => {
    const app = Fastify(); registerIngressMemory(app)
    let finish!: () => void
    const gate = new Promise<void>(resolve => { finish = resolve })
    app.post('/held', async (request, reply) => {
      retainIngressUntilSettled(request)
      reply.hijack(); reply.raw.end('delivered')
      try { await gate } finally { releaseIngressMemory(request) }
    })
    try {
      expect((await app.inject({ method: 'POST', url: '/held', payload: { text: 'hello' } })).body).toBe('delivered')
      expect(ingressMemoryBytes()).toBeGreaterThan(0)
      finish(); await vi.waitFor(() => expect(ingressMemoryBytes()).toBe(0))
    } finally { finish(); await app.close() }
  })
  it('shares an upstream peak budget across concurrent requests and releases failed owners', async () => {
    const previous = config.UPSTREAM_MEMORY_MAX_BYTES
    config.UPSTREAM_MEMORY_MAX_BYTES = 90
    let finish!: () => void
    const gate = new Promise<void>(resolve => { finish = resolve })
    const pending = withUpstreamMemory(async () => { accountUpstreamMemory(20); await gate })
    try {
      await expect(withUpstreamMemory(async () => { accountUpstreamMemory(20) })).rejects.toMatchObject({ statusCode: 503 })
      expect(upstreamMemoryBytes()).toBe(60)
      finish(); await pending; expect(upstreamMemoryBytes()).toBe(0)
    } finally { finish(); config.UPSTREAM_MEMORY_MAX_BYTES = previous }
  })
  it('bounds queued financial work and starts the next item on completion', async () => {
    const executor = new WriteExecutor(1, 1)
    let release!: () => void
    const first = executor.run(() => new Promise<void>(resolve => { release = resolve }))
    const second = executor.run(async () => 2)
    await expect(executor.run(async () => 3)).rejects.toThrow('capacity')
    await Promise.resolve(); release(); await first; expect(await second).toBe(2)
  })
})

describe('management boundary rules', () => {
  it('validates and enforces IP/CIDR allow rules including mapped IPv4', () => {
    expect(validIpRule('127.0.0.1/33')).toBe(false)
    expect(validIpRule('::1/128')).toBe(true)
    expect(ipAllowed('::ffff:127.0.0.1', ['127.0.0.0/8'])).toBe(true)
    expect(ipAllowed('10.0.0.1', ['127.0.0.0/8'])).toBe(false)
  })
  it('normalizes Gmail aliases without changing other domain mailbox identities', () => {
    expect(mailboxIdentity('A.B+tag@googlemail.com')).toBe('ab@gmail.com')
    expect(mailboxIdentity('first.last+tag@company.com')).toBe('first.last+tag@company.com')
  })
})
