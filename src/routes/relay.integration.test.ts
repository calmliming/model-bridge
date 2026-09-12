import { upstreamSignal } from '../http/cancellation'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'

const mocks = vi.hoisted(() => ({
  balance: 1_000, quota: 0, logs: [] as unknown[][], transactions: [] as unknown[][],
  cost: 0.01, key: {} as Record<string, unknown>,
  fetch: vi.fn(), query: vi.fn(), connect: vi.fn(),
  consumeSubscriptionUsage: vi.fn(), resolveActiveSubscription: vi.fn(),
  pickAccount: vi.fn(), markAccountUsed: vi.fn(), penalizeAccount: vi.fn(), penalizeAccountModel: vi.fn(),
  ensureFreshToken: vi.fn(),
  cachedAntigravityModels: vi.fn(),
  cachedAccountCatalogs: vi.fn(),
  accounts: [] as Array<{ id: string; concurrencyLimit: number | null; metadata: Record<string, unknown> | null; proxyUrl?: string | null }>,
}))

vi.mock('../db/index', () => ({
  db: { update: () => ({ set: () => ({ where: async () => undefined }) }) },
  pool: { query: mocks.query, connect: mocks.connect },
}))
vi.mock('../keys/manager', () => ({
  findApiKeyBySecret: async () => ({ ...mocks.key, userBalanceMicros: mocks.balance }),
}))
vi.mock('../accounts/antigravityModels', () => ({ cachedAntigravityModels: mocks.cachedAntigravityModels }))
vi.mock('../accounts/modelCatalog', () => ({ cachedAccountCatalogs: mocks.cachedAccountCatalogs }))
vi.mock('../accounts/scheduler', () => ({
  pickAccount: mocks.pickAccount,
  markAccountUsed: mocks.markAccountUsed,
  penalizeAccount: mocks.penalizeAccount,
  penalizeAccountModel: mocks.penalizeAccountModel,
  disableAccount: async () => undefined,
}))
vi.mock('../accounts/manager', () => ({
  ensureFreshToken: mocks.ensureFreshToken,
  accountConcurrencyKey: (id: string) => `account:${id}`,
  updateAccountQuota: async () => undefined,
}))
vi.mock('../usage/pricing', () => ({ estimateCost: () => mocks.cost, resolvePrice: () => null, resolveUsagePrice: () => null }))
vi.mock('../subscriptions/manager', () => ({
  resolveActiveSubscription: mocks.resolveActiveSubscription,
  hasWindowHeadroom: async () => true,
  consumeSubscriptionUsage: mocks.consumeSubscriptionUsage,
}))
vi.mock('../http/upstream', () => ({ fetchWithConnectTimeout: mocks.fetch }))

import { registerRelayRoutes } from './relay'
import { waitForPendingUsage } from '../usage/recorder'
import { adjustWalletUsd } from '../wallet/manager'
import { resetLimits, currentConcurrency } from '../middleware/limits'

function sse(events: unknown[]): Response {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  })
}

function openaiResponse(): Response {
  return sse([{ type: 'response.completed', response: {
    id: 'resp_test', object: 'response', model: 'gpt-5.4', status: 'completed',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Paid answer' }] }],
    usage: { input_tokens: 100, output_tokens: 100 },
  } }])
}

function claudeResponse(): Response {
  return sse([
    { type: 'message_start', message: { id: 'msg_test', model: 'claude-sonnet-5', usage: { input_tokens: 100 } } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 100 } },
    { type: 'message_stop' },
  ])
}

beforeEach(async () => {
  vi.clearAllMocks()
  await resetLimits()
  mocks.balance = 1_000
  mocks.quota = 0
  mocks.logs = []
  mocks.transactions = []
  mocks.cost = 0.01
  mocks.accounts = [{ id: 'account-1', concurrencyLimit: null, metadata: null }]
  mocks.pickAccount.mockImplementation(async (_provider: string, excluded: string[]) =>
    mocks.accounts.find(account => !excluded.includes(account.id)) ?? null)
  mocks.markAccountUsed.mockResolvedValue(undefined)
  mocks.penalizeAccount.mockResolvedValue(undefined)
  mocks.penalizeAccountModel.mockResolvedValue(undefined)
  mocks.ensureFreshToken.mockResolvedValue('test-upstream-token')
  mocks.cachedAntigravityModels.mockResolvedValue(['gemini-3.8-flash', 'claude-sonnet-5'])
  mocks.cachedAccountCatalogs.mockResolvedValue({ providerModels: {}, catalogModels: {} })
  mocks.key = {
    id: 'key-1', name: 'Test', enabled: true, expiresAt: null,
    quotaLimit: null, quotaUsed: 0, userId: 'user-1', userStatus: 'active',
    accountGroupId: null, modelMappings: null, allowedProviders: null,
    allowedModels: null, rateLimit: null, concurrencyLimit: null,
    userConcurrencyLimit: null, groupMultiplier: 1,
  }
  mocks.resolveActiveSubscription.mockResolvedValue({ subscriptionId: 'sub-1', planLimits: {} })
  mocks.consumeSubscriptionUsage.mockResolvedValue(false)
  mocks.fetch.mockImplementation(async () => openaiResponse())

  // Transactional storage double. Real auth, relay, usage recording, wallet
  // arithmetic, and SQL calls run; transactions serialize as row locks would.
  let tail = Promise.resolve()
  mocks.connect.mockImplementation(async () => {
    const previous = tail
    let unlock!: () => void
    tail = new Promise<void>(resolve => { unlock = resolve })
    await previous
    const snapshot = {
      balance: mocks.balance, quota: mocks.quota,
      logs: [...mocks.logs], transactions: [...mocks.transactions],
    }
    return {
      query: async (sql: string, values: unknown[] = []) => {
        if (sql === 'ROLLBACK') Object.assign(mocks, snapshot)
        return mocks.query(sql, values)
      },
      release: unlock,
    }
  })
  mocks.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql.startsWith('INSERT INTO usage_logs')) mocks.logs.push(values)
    if (sql.startsWith('UPDATE api_keys SET quota_used')) mocks.quota += Number(values[0])
    if (sql.startsWith('SELECT balance_micros FROM users')) return { rows: [{ balance_micros: mocks.balance }] }
    if (sql.startsWith('UPDATE users SET balance_micros')) mocks.balance = Number(values[0])
    if (sql.startsWith('INSERT INTO wallet_transactions')) {
      mocks.transactions.push(values)
      return { rows: [{
        id: values[0], user_id: values[1], type: values[2], amount_micros: values[3],
        balance_after_micros: values[4], usage_log_id: values[5], created_at: Date.now(),
      }] }
    }
    return { rows: [], rowCount: 0 }
  })
})

async function withRelay(run: (request: (
  payload: Record<string, unknown>, url?: string,
) => Promise<{ status: number; contentType: string; body: string }>) => Promise<void>) {
  const app = Fastify()
  registerRelayRoutes(app)
  // Real loopback sockets cover hijacked streaming replies as well as JSON.
  const origin = await app.listen({ host: '127.0.0.1', port: 0 })
  try {
    await run(async (payload, url = '/v1/responses') => {
      const response = await fetch(`${origin}${url}`, {
        method: 'POST', headers: { authorization: 'Bearer mb-test', 'content-type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(5_000),
      })
      const body = await response.text()
      await waitForPendingUsage()
      return { status: response.status, contentType: response.headers.get('content-type') ?? '', body }
    })
  } finally {
    await app.close()
    await waitForPendingUsage()
  }
}

const prompt = { model: 'gpt-5.4', stream: true, input: 'Hi' }

describe('relay settlement', () => {
  it('persists an over-balance charge and rejects the next request', () => withRelay(async (request) => {
    const first = await request(prompt)
    expect(first.status).toBe(200)
    expect(first.body).toContain('Paid answer')
    expect(mocks.balance).toBe(-9_000)
    expect(mocks.quota).toBe(0.01)
    expect(mocks.logs).toHaveLength(1)
    expect(mocks.transactions[0]?.slice(2, 5)).toEqual(['usage', -10_000, -9_000])
    expect(mocks.transactions[0]?.[5]).toBe(mocks.logs[0]?.[0])
    const second = await request(prompt)
    expect(second.status).toBe(402)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.query.mock.calls.some(call => call[0] === 'ROLLBACK')).toBe(false)
  }))

  it('persists subscription overflow and blocks repeated fallback into debt', () => withRelay(async (request) => {
    mocks.balance = 0
    mocks.key.accountGroupId = 'group-1'
    expect((await request(prompt)).status).toBe(200)
    expect(mocks.consumeSubscriptionUsage).toHaveBeenCalledWith(expect.anything(), 'sub-1', 0.01)
    expect(mocks.logs[0]?.[21]).toBe('balance')
    expect(mocks.balance).toBe(-10_000)
    expect((await request(prompt)).status).toBe(402)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  }))

  it('settles all requests already in flight when the balance runs out', () => withRelay(async (request) => {
    let ready!: () => void
    const bothAdmitted = new Promise<void>(resolve => { ready = resolve })
    let calls = 0
    mocks.fetch.mockImplementation(async () => {
      if (++calls === 2) ready()
      await bothAdmitted
      return openaiResponse()
    })
    const responses = await Promise.all([request(prompt), request(prompt)])
    expect(responses.map(response => response.status)).toEqual([200, 200])
    expect(mocks.balance).toBe(-19_000)
    expect(mocks.quota).toBe(0.02)
    expect(mocks.logs).toHaveLength(2)
    expect(mocks.transactions).toHaveLength(2)
  }))

  it('allows calls again after a top-up covers the debt', () => withRelay(async (request) => {
    await request(prompt)
    await adjustWalletUsd({ userId: 'user-1', amount: 0.02 })
    expect(mocks.balance).toBe(11_000)
    expect((await request(prompt)).status).toBe(200)
    expect(mocks.balance).toBe(1_000)
    expect(mocks.logs).toHaveLength(2)
  }))
})

describe('Claude Chat Completions response format', () => {
  it.each([false, undefined])('returns buffered JSON for stream=%s', (stream) => withRelay(async (request) => {
    mocks.balance = 20_000
    mocks.fetch.mockImplementation(async () => claudeResponse())
    const response = await request({ model: 'claude-sonnet-5', stream,
      messages: [{ role: 'user', content: 'Hi' }] }, '/api/claude/v1/chat/completions')
    expect(response.status).toBe(200)
    expect(response.contentType).toContain('application/json')
    expect(JSON.parse(response.body)).toMatchObject({ object: 'chat.completion',
      choices: [{ message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }] })
    expect(JSON.parse(mocks.fetch.mock.calls[0]![1].body).stream).toBe(true)
    expect(mocks.balance).toBe(10_000)
    expect(mocks.logs[0]?.slice(9, 11)).toEqual([100, 100])
  }))

  it('keeps streamed Chat Completions working on the clean route', () => withRelay(async (request) => {
    mocks.fetch.mockImplementation(async () => claudeResponse())
    const response = await request({ model: 'claude-sonnet-5', stream: true,
      messages: [{ role: 'user', content: 'Hi' }] }, '/v1/chat/completions')
    expect(response.status).toBe(200)
    expect(response.contentType).toContain('text/event-stream')
    expect(response.body).toContain('chat.completion.chunk')
    expect(response.body).toContain('[DONE]')
    expect(mocks.logs).toHaveLength(1)
  }))
})

describe('upstream request compatibility', () => {
  it('serves dynamic model details using the same key/group filters as the model list', async () => {
    mocks.key.allowedProviders = ['openai']
    mocks.key.accountGroupId = 'group-a'
    mocks.key.groupAllowedModels = ['gpt-visible']
    mocks.cachedAccountCatalogs.mockResolvedValue({ providerModels: { openai: ['gpt-visible', 'gpt-hidden'] },
      catalogModels: { openai: { 'gpt-visible': { id: 'gpt-visible', context_window: 123456, input_modalities: ['text', 'image'] } } } })
    const app = Fastify()
    registerRelayRoutes(app)
    try {
      const headers = { authorization: 'Bearer mb-test' }
      const listing = await app.inject({ url: '/v1/models', headers })
      expect(listing.json().data).toEqual([expect.objectContaining({ id: 'gpt-visible', context_window: 123456 })])
      const detail = await app.inject({ url: '/v1/models/gpt-visible', headers })
      expect(detail.json()).toMatchObject({ id: 'gpt-visible', input_modalities: ['text', 'image'] })
      expect((await app.inject({ url: '/api/openai/v1/models/gpt-hidden', headers })).statusCode).toBe(404)
      expect(mocks.cachedAccountCatalogs).toHaveBeenCalledWith('group-a', ['openai'])
      expect(mocks.fetch).not.toHaveBeenCalled()
    } finally { await app.close() }
  })

  it.each([
    { stream: false, payload: { error: { code: 503, status: 'UNAVAILABLE', message: 'Unavailable at https://private.example' } }, code: 'gemini_upstream_UNAVAILABLE' },
    { stream: true, payload: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Limit reached' } }, code: 'gemini_upstream_RESOURCE_EXHAUSTED' },
    { stream: false, payload: { promptFeedback: { blockReason: 'SAFETY' } }, code: 'gemini_policy_SAFETY' },
    { stream: true, payload: { candidates: [{ finishReason: 'SAFETY' }] }, code: 'gemini_policy_SAFETY' },
    { stream: false, payload: {}, code: 'gemini_empty_response' },
    { stream: true, payload: { candidates: [{ finishReason: 'MALFORMED_FUNCTION_CALL' }] }, code: null },
  ])('records native Gemini $code with stream=$stream while preserving its response', ({ stream, payload, code }) => withRelay(async request => {
    mocks.accounts[0]!.metadata = { project: 'test-project' }
    const body = { ...payload, usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }
    mocks.fetch.mockResolvedValueOnce(stream ? sse([{ response: body }])
      : new Response(JSON.stringify({ response: body }), { headers: { 'content-type': 'application/json' } }))
    const response = await request({ contents: [] }, `/api/gemini/v1beta/models/gemini-3.8-flash:${stream ? 'streamGenerateContent' : 'generateContent'}`)
    expect(response.status).toBe(200)
    expect(response.body).toContain(JSON.stringify(body))
    expect(mocks.logs[0]?.[22]).toBe(code ? 'error' : 'success')
    expect(mocks.logs[0]?.[23]).toBe(code)
    expect(mocks.logs[0]?.slice(9, 11)).toEqual([10, 5])
    expect(mocks.logs[0]?.[24] ?? '').not.toContain('private.example')
    expect(mocks.penalizeAccount).not.toHaveBeenCalled()
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  }))

  it.each([false, true])('forwards Claude message output_config with its required beta for stream=%s', stream => withRelay(async request => {
    mocks.fetch.mockImplementation(async () => stream ? claudeResponse() : new Response(JSON.stringify({
      id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-5',
      content: [{ type: 'text', text: 'Hello' }], stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 100 },
    }), { headers: { 'content-type': 'application/json' } }))
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi', output_config: { effort: 'low' } },
      { role: 'system', content: [], output_config: { effort: 'high' } },
      { role: 'user', content: 'Continue', output_config: { effort: 'high' } },
    ]
    const response = await request({ model: 'claude-sonnet-5', stream, messages,
      output_config: { effort: 'medium' } }, '/api/claude/v1/messages')
    expect(response.status).toBe(200)
    const [url, init] = mocks.fetch.mock.calls[0]!
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(new Headers(init.headers).get('anthropic-beta')?.split(','))
      .toContain('mid-conversation-output-config-2026-07-01')
    expect(JSON.parse(init.body)).toMatchObject({ messages, output_config: { effort: 'medium' }, stream })
  }))

  it.each([
    { provider: 'qwen', model: 'qwen3.8-max', upstream: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions' },
    { provider: 'zhipu', model: 'glm-5.3', upstream: 'https://open.bigmodel.cn/api/paas/v4/chat/completions' },
    { provider: 'xiaomi', model: 'mimo-v2.5', upstream: 'https://api.xiaomimimo.com/v1/chat/completions' },
    { provider: 'kimi', model: 'kimi-k2.7-code', upstream: 'https://api.moonshot.cn/v1/chat/completions' },
  ])('delivers agent task bodies through the $provider Responses route', ({ provider, model, upstream }) => withRelay(async request => {
    mocks.fetch.mockImplementation(async () => sse([
      { id: 'chat-task', model, choices: [{ index: 0, delta: { role: 'assistant', content: 'Task received' }, finish_reason: null }] },
      { id: 'chat-task', model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 } },
    ]))
    const response = await request({ model, stream: true, input: [
      { type: 'agent_message', author: '/root', recipient: '/root/check', content: [
        { type: 'input_text', text: 'Message Type: NEW_TASK\nPayload:\n' },
        { type: 'encrypted_content', encrypted_content: 'Check the relay compatibility.' },
      ] },
    ] }, `/api/${provider}/v1/responses`)
    expect(response.status).toBe(200)
    expect(mocks.fetch.mock.calls[0]?.[0]).toBe(upstream)
    expect(JSON.parse(mocks.fetch.mock.calls[0]?.[1].body)).toMatchObject({ model, stream: true,
      messages: [{ role: 'user', content: 'Message Type: NEW_TASK\nPayload:\nCheck the relay compatibility.' }] })
    expect(response.body).toContain('Task received')
    expect(response.body).toContain('response.completed')
    expect(mocks.logs).toHaveLength(1)
    expect(mocks.logs[0]?.slice(9, 11)).toEqual([10, 5])
  }))
})

describe('mapped provider dispatch', () => {
  it.each(['/v1/responses', '/api/deepseek/v1/responses', '/v1/chat/completions', '/api/deepseek/v1/chat/completions'])(
    'routes V4.1 Flash images and tools through %s', (url) => withRelay(async (request) => {
      const chat = url.endsWith('/chat/completions')
      const imageUrl = 'https://example.com/chart.png'
      const payload = chat ? {
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: imageUrl } }] }],
        tools: [{ type: 'function', function: { name: 'inspect_chart', parameters: { type: 'object' } } }],
      } : {
        input: [{ role: 'user', content: [{ type: 'input_image', image_url: imageUrl }] }],
        tools: [{ type: 'function', name: 'inspect_chart', parameters: { type: 'object' } }],
      }
      mocks.key.allowedProviders = ['deepseek']
      const response = await request({ ...payload, model: 'deepseek-flash', stream: false }, url)
      expect(response.status).toBe(200)
      const [upstreamUrl, init] = mocks.fetch.mock.calls[0]!
      expect(upstreamUrl).toBe('https://api.deepseek.com/v1/responses')
      const upstreamBody = JSON.parse(init.body)
      expect(upstreamBody.model).toBe('deepseek-flash')
      expect(JSON.stringify(upstreamBody.input)).toContain(imageUrl)
      expect(upstreamBody.tools[0].name).toBe('inspect_chart')
      expect(mocks.logs[0]?.slice(4, 6)).toEqual(['deepseek', 'deepseek-flash'])
    }),
  )

  it.each(['/v1/messages', '/api/deepseek/v1/messages'])(
    'routes V4.1 Flash images through the Anthropic endpoint at %s', (url) => withRelay(async (request) => {
      mocks.key.allowedProviders = ['deepseek']
      mocks.fetch.mockImplementation(async () => new Response(JSON.stringify({
        id: 'msg_deepseek', type: 'message', role: 'assistant', model: 'deepseek-flash',
        content: [{ type: 'text', text: 'A chart' }], stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 20 },
      }), { headers: { 'content-type': 'application/json' } }))
      const messages = [{ role: 'user', content: [{ type: 'image', source: { type: 'url', url: 'https://example.com/chart.png' } }] }]
      const response = await request({ model: 'deepseek-flash', messages, max_tokens: 100, stream: false }, url)
      expect(response.status).toBe(200)
      const [upstreamUrl, init] = mocks.fetch.mock.calls[0]!
      expect(upstreamUrl).toBe('https://api.deepseek.com/anthropic/v1/messages')
      expect(JSON.parse(init.body)).toMatchObject({ model: 'deepseek-flash', messages })
      expect(mocks.logs[0]?.slice(4, 6)).toEqual(['deepseek', 'deepseek-flash'])
    }),
  )

  it.each(['/v1/responses', '/responses'])('routes a cross-provider alias to OpenAI at %s', (url) => withRelay(async (request) => {
    mocks.key.modelMappings = { 'deepseek-v4-pro': 'gpt-5.4' }
    mocks.key.allowedProviders = ['openai']
    const response = await request({ ...prompt, model: 'deepseek-v4-pro' }, url)
    expect(response.status).toBe(200)
    expect(JSON.parse(mocks.fetch.mock.calls[0]![1].body).model).toBe('gpt-5.4')
    expect(mocks.logs[0]?.slice(4, 6)).toEqual(['openai', 'gpt-5.4'])
  }))

  it('does not allow the alias source provider to bypass the target provider restriction', () => withRelay(async (request) => {
    mocks.key.modelMappings = { 'deepseek-v4-pro': 'gpt-5.4' }
    mocks.key.allowedProviders = ['deepseek']
    expect((await request({ ...prompt, model: 'deepseek-v4-pro' })).status).toBe(403)
    expect(mocks.fetch).not.toHaveBeenCalled()
  }))

  it('preserves Sub2API-only routing even when a mapping targets a native model', () => withRelay(async (request) => {
    mocks.key.modelMappings = { 'deepseek-v4-pro': 'gpt-5.4' }
    mocks.key.allowedProviders = ['sub2api']
    // No gateway URL is configured in the fixture; choosing the native OpenAI
    // provider would incorrectly succeed instead of reporting this failure.
    const response = await request({ ...prompt, model: 'deepseek-v4-pro' })
    expect(response.status).toBe(503)
    expect(mocks.logs[0]?.[4]).toBe('sub2api')
    expect(mocks.fetch).not.toHaveBeenCalled()
  }))
})

describe('upstream compatibility regressions', () => {
  it.each(['/v1/responses', '/v1/chat/completions'])('records partial usage and diagnostics on stream failure at %s', (url) => withRelay(async (request) => {
    mocks.fetch.mockImplementation(async () => {
      const response = sse([
        { type: 'response.output_text.delta', delta: 'Partial answer' },
        { type: 'response.failed', response: { model: 'gpt-5.4',
          error: { code: 'server_error', message: 'Capacity failed at https://backend.example/retry Bearer secret' },
          usage: { input_tokens: 100, output_tokens: 20 } } },
      ])
      response.headers.set('x-request-id', 'req-upstream-1')
      return response
    })
    const response = await request(prompt, url)
    expect(response.body).toContain('Partial answer')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.logs[0]?.slice(9, 11)).toEqual([100, 20])
    expect(mocks.logs[0]?.slice(22, 25)).toEqual(['error', 'server_error',
      'Capacity failed at [redacted-url] Bearer [redacted]'])
    expect(mocks.logs[0]?.[31]).toBe('req-upstream-1')
  }))

  it('retains the last converted event when SSE closes without a blank separator', () => withRelay(async (request) => {
    mocks.fetch.mockImplementation(async () => new Response((await openaiResponse().text()).trimEnd(),
      { headers: { 'content-type': 'text/event-stream' } }))
    const response = await request(prompt, '/v1/chat/completions')
    expect(response.body).not.toContain('upstream_stream_closed')
    expect(mocks.logs[0]?.[22]).toBe('success')
    expect(mocks.logs[0]?.slice(9, 11)).toEqual([100, 100])
  }))

  it('tries another account for a model-not-found response and only cools the model', () => withRelay(async (request) => {
    mocks.accounts.push({ ...mocks.accounts[0]!, id: 'account-2' })
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'model_not_found', message: 'Model unavailable' } }),
      { status: 400, headers: { 'content-type': 'application/json' } }))
    const response = await request({ model: 'gpt-5.4', messages: [{ role: 'user', content: 'Hi' }], stream: false }, '/v1/chat/completions')
    expect(response.status).toBe(200)
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(mocks.penalizeAccountModel).toHaveBeenCalledWith('account-1', 'gpt-5.4', 'error', undefined)
    expect(mocks.penalizeAccount).not.toHaveBeenCalled()
    expect(mocks.logs[0]?.[26]).toBe(2)
  }))

  it.each([400, 404])('preserves the original HTTP %s when no candidate supports the model', (status) => withRelay(async (request) => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'model_not_found', message: 'Model unavailable' } }),
      { status, headers: { 'content-type': 'application/json' } }))
    const response = await request({ model: 'gpt-5.4', stream: false }, '/v1/chat/completions')
    expect(response.status).toBe(status)
    expect(JSON.parse(response.body)).toMatchObject({ error: { code: 'model_not_found' } })
    expect(mocks.logs).toHaveLength(1)
  }))

  it('does not switch accounts for ordinary invalid parameters', () => withRelay(async (request) => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'invalid_request_error', message: 'Invalid tools parameter' } }), { status: 400 }))
    expect((await request({ model: 'gpt-5.4', stream: false }, '/v1/chat/completions')).status).toBe(400)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.penalizeAccountModel).not.toHaveBeenCalled()
  }))

  it('releases the acquired account slot even when refresh error handling itself fails', () => withRelay(async (request) => {
    mocks.accounts[0]!.concurrencyLimit = 1
    mocks.ensureFreshToken.mockRejectedValue(new Error('temporary refresh failure'))
    mocks.penalizeAccount.mockRejectedValue(new Error('database unavailable'))
    expect((await request(prompt)).status).toBe(500)
    expect(await currentConcurrency('account:account-1')).toBe(0)
  }))

  it('routes K3 to native Responses and preserves the caller response format', () => withRelay(async (request) => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ object: 'response', model: 'kimi-k3', status: 'completed',
      output: [], usage: { input_tokens: 10, output_tokens: 5 } }), { headers: { 'content-type': 'application/json' } }))
    const response = await request({ model: 'k3', stream: false, input: 'Hi', tools: [{ type: 'web_search' }] }, '/api/kimi/v1/responses')
    expect(response.contentType).toContain('application/json')
    expect(mocks.fetch.mock.calls[0]?.[0]).toBe('https://api.moonshot.cn/v1/responses')
    expect(JSON.parse(mocks.fetch.mock.calls[0]?.[1].body)).toMatchObject({ model: 'kimi-k3', tools: [{ type: 'web_search' }] })
    expect(mocks.logs[0]?.slice(9, 11)).toEqual([10, 5])
  }))
})


describe('MiniMax and group admission', () => {
  it.each(['/v1/responses', '/api/minimax/v1/responses'])('routes MiniMax natively at %s and records JSON usage', url => withRelay(async request => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ object: 'response', model: 'MiniMax-M3', status: 'completed', output: [],
      usage: { input_tokens: 50, output_tokens: 12, input_tokens_details: { cached_tokens: 10, image_tokens: 20 } } }),
      { headers: { 'content-type': 'application/json' } }))
    const result = await request({ model: 'MiniMax-M3', input: 'Hello', stream: false }, url)
    expect(result.status).toBe(200)
    expect(mocks.fetch.mock.calls[0]?.[0]).toBe('https://api.minimaxi.com/v1/responses')
    expect(mocks.logs[0]?.[4]).toBe('minimax')
    expect(mocks.logs[0]?.slice(9, 11)).toEqual([40, 12])
  }))

  it('records unsuccessful native JSON as an error while retaining its usage', () => withRelay(async request => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ object: 'response', model: 'MiniMax-M3', status: 'incomplete', output: [],
      usage: { input_tokens: 50, output_tokens: 12 } }), { headers: { 'content-type': 'application/json' } }))
    await request({ model: 'MiniMax-M3', input: 'Hello', stream: false })
    expect(mocks.logs[0]?.[22]).toBe('error')
    expect(mocks.logs[0]?.slice(9, 11)).toEqual([50, 12])
  }))

  it.each(['/v1/responses', '/api/minimax/v1/responses', '/v1/chat/completions', '/v1/messages', '/v1/responses/input_tokens'])('blocks an alias outside the group before any upstream call at %s', url => withRelay(async request => {
    mocks.key.groupAllowedModels = ['MiniMax-*']
    mocks.key.modelMappings = { alias: 'MiniMax-M3' }
    const result = await request({ model: 'alias', stream: false, input: 'Hi' }, url)
    expect(result.status).toBe(404)
    expect(result.body).toContain('model_not_allowed')
    expect(mocks.pickAccount).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.logs).toHaveLength(0)
  }))

  it('keeps key restrictions when the group allows a model', () => withRelay(async request => {
    mocks.key.groupAllowedModels = ['MiniMax-*']
    mocks.key.allowedModels = ['gpt-*']
    expect((await request({ model: 'MiniMax-M3', input: 'Hi' })).status).toBe(403)
    expect(mocks.fetch).not.toHaveBeenCalled()
  }))

  it('uses the Gemini path model for group policy', () => withRelay(async request => {
    mocks.key.groupAllowedModels = ['MiniMax-*']
    expect((await request({ contents: [] }, '/v1beta/models/gemini-3.8-flash:generateContent')).status).toBe(404)
    expect(mocks.fetch).not.toHaveBeenCalled()
  }))
})

describe('client cancellation', () => {
  it.each([false, true])('aborts upstream and releases all slots after disconnect (headers sent: %s)', async headersSent => {
    mocks.accounts[0]!.concurrencyLimit = 1
    mocks.key.concurrencyLimit = 1
    mocks.key.userConcurrencyLimit = 1
    let started!: () => void
    const upstreamStarted = new Promise<void>(resolve => { started = resolve })
    let canceled = false
    mocks.fetch.mockImplementation(async () => {
      const signal = upstreamSignal()!
      started()
      if (!headersSent) return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => { canceled = true; reject(signal.reason) }, { once: true })
      })
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"message_start","message":{"usage":{"input_tokens":42}}}\n\n'))
        signal.addEventListener('abort', () => { canceled = true; controller.error(signal.reason) }, { once: true })
      } }), { headers: { 'content-type': 'text/event-stream' } })
    })
    const app = Fastify()
    registerRelayRoutes(app)
    const origin = await app.listen({ host: '127.0.0.1', port: 0 })
    const client = new AbortController()
    try {
      const pending = fetch(`${origin}/v1/messages`, {
        method: 'POST', headers: { authorization: 'Bearer mb-test', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-5', stream: true, messages: [{ role: 'user', content: 'Hello' }] }),
        signal: client.signal,
      })
      const result = pending.catch(() => null)
      await upstreamStarted
      if (headersSent) {
        const response = await result
        const reader = response!.body!.getReader()
        await reader.read()
        client.abort()
        await reader.cancel().catch(() => {})
      } else client.abort()
      await result
      await vi.waitFor(async () => {
        expect(canceled).toBe(true)
        expect(await currentConcurrency('account:account-1')).toBe(0)
        expect(await currentConcurrency('key-1')).toBe(0)
        expect(await currentConcurrency('user:user-1')).toBe(0)
      })
      expect(mocks.fetch).toHaveBeenCalledOnce()
      expect(mocks.penalizeAccount).not.toHaveBeenCalled()
      expect(mocks.penalizeAccountModel).not.toHaveBeenCalled()
      expect(mocks.logs[0]?.[23]).toBe('client_disconnected')
      if (headersSent) expect(mocks.logs[0]?.[9]).toBe(42)
    } finally {
      client.abort()
      await app.close()
      await waitForPendingUsage()
    }
  })
})


describe('Antigravity through Sub2API', () => {
  it('serves group-filtered Gemini discovery through the same gateway scope', async () => {
    mocks.key.allowedProviders = ['sub2api']
    mocks.key.groupAllowedModels = ['gemini-3.8-*']
    const app = Fastify()
    registerRelayRoutes(app)
    try {
      for (const url of ['/v1beta/models', '/api/sub2api/v1beta/models']) {
        const response = await app.inject({ method: 'GET', url, headers: { authorization: 'Bearer mb-test' } })
        expect(response.statusCode).toBe(200)
        expect(response.json().models.map((m: { name: string }) => m.name)).toEqual(['models/gemini-3.8-flash'])
      }
      const rejected = await app.inject({ method: 'GET', url: '/api/gemini/v1beta/models', headers: { authorization: 'Bearer mb-test' } })
      expect(rejected.statusCode).toBe(403)
      expect(mocks.fetch).not.toHaveBeenCalled()
    } finally { await app.close() }
  })
  it.each(['/api/sub2api/v1beta/models/gemini-3.8-flash:generateContent', '/v1beta/models/gemini-3.8-flash:generateContent'])('routes native Gemini via the gateway at %s', url => withRelay(async request => {
    mocks.key.allowedProviders = ['sub2api']
    mocks.accounts[0]!.proxyUrl = 'https://gateway.example/antigravity'
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Hi' }] } }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 15, cachedContentTokenCount: 40 } }),
      { headers: { 'content-type': 'application/json' } }))
    const response = await request({ contents: [{ role: 'user', parts: [{ text: 'Hi' }] }] }, url)
    expect(response.status).toBe(200)
    expect(mocks.fetch.mock.calls[0]?.[0]).toBe('https://gateway.example/antigravity/v1beta/models/gemini-3.8-flash:generateContent')
    expect(mocks.pickAccount.mock.calls[0]?.[0]).toBe('sub2api')
    expect(mocks.logs[0]?.[4]).toBe('sub2api')
    expect(mocks.logs[0]?.slice(9, 12)).toEqual([60, 35, 15])
  }))

  it('streams native Gemini without wrapping or removing signed parts', () => withRelay(async request => {
    mocks.key.allowedProviders = ['sub2api']
    mocks.accounts[0]!.proxyUrl = 'https://gateway.example/antigravity/v1beta'
    mocks.fetch.mockResolvedValueOnce(sse([{ candidates: [{ content: { parts: [{ text: 'ok', thoughtSignature: 'signed' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, thoughtsTokenCount: 3 } }]))
    const response = await request({ contents: [] }, '/v1beta/models/gemini-3.8-flash:streamGenerateContent')
    expect(response.body).toContain('thoughtSignature')
    expect(response.body).not.toContain('response.completed')
    expect(mocks.fetch.mock.calls[0]?.[0]).toContain(':streamGenerateContent?alt=sse')
    expect(mocks.logs[0]?.slice(9, 12)).toEqual([10, 5, 3])
  }))

  it('keeps region failures local to one gateway account and preserves the final diagnosis', () => withRelay(async request => {
    mocks.key.allowedProviders = ['sub2api']
    mocks.accounts[0]!.proxyUrl = 'https://gateway.example/antigravity'
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 400, status: 'FAILED_PRECONDITION', message: 'User location is not supported for the API use.' } }), { status: 400 }))
    const response = await request({ contents: [] }, '/v1beta/models/gemini-3.8-flash:generateContent')
    expect(response.status).toBe(400)
    expect(response.body).toContain('google_location_unsupported')
    expect(mocks.fetch).toHaveBeenCalledOnce()
    expect(mocks.penalizeAccount).toHaveBeenCalledWith('account-1', 'error', undefined)
    expect(mocks.penalizeAccountModel).not.toHaveBeenCalled()
    expect(mocks.logs[0]?.[23]).toBe('google_location_unsupported')
  }))

  it('rotates to another gateway account after a region rejection', () => withRelay(async request => {
    mocks.key.allowedProviders = ['sub2api']
    mocks.accounts[0]!.proxyUrl = 'https://gateway.example/antigravity'
    mocks.accounts.push({ id: 'account-2', concurrencyLimit: null, metadata: null, proxyUrl: 'https://other-gateway.example/antigravity' })
    mocks.fetch.mockResolvedValueOnce(new Response('User location is not supported for the API use.', { status: 403 }))
    mocks.fetch.mockResolvedValueOnce(new Response('{"candidates":[]}', { headers: { 'content-type': 'application/json' } }))
    expect((await request({ contents: [] }, '/v1beta/models/gemini-3.8-flash:generateContent')).status).toBe(200)
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(mocks.fetch.mock.calls[1]?.[0]).toContain('other-gateway.example/antigravity')
    expect(mocks.penalizeAccount).toHaveBeenCalledTimes(1)
  }))

  it('rejects invalid tool references and non-inference actions before account selection', () => withRelay(async request => {
    mocks.key.allowedProviders = ['sub2api']
    const response = await request({ tools: [{ functionDeclarations: [{ name: 'bad', parameters: { $ref: '#/missing' } }] }] },
      '/v1beta/models/gemini-3.8-flash:generateContent')
    expect(response.status).toBe(400)
    expect(response.body).toContain('invalid_tool_schema')
    expect((await request({}, '/v1beta/models/gemini-3.8-flash:loadCodeAssist')).status).toBe(400)
    expect(mocks.pickAccount).not.toHaveBeenCalled()
    expect(mocks.penalizeAccount).not.toHaveBeenCalled()
  }))
})


describe('native Antigravity relay', () => {
  it('provides a guarded local token preflight without consuming Google quota', () => withRelay(async request => {
    mocks.key.allowedProviders = ['antigravity']
    const result = await request({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'Estimate this request' }] }, '/api/antigravity/v1/messages/count_tokens')
    expect(result.status).toBe(200)
    expect(JSON.parse(result.body).input_tokens).toBeGreaterThan(0)
    mocks.key.groupAllowedModels = ['gemini-*']
    expect((await request({ model: 'claude-sonnet-5', messages: [] }, '/v1/messages/count_tokens')).status).toBe(404)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.pickAccount).not.toHaveBeenCalled()
  }))
  function nativeResponse() {
    return sse([{ response: { candidates: [{ content: { parts: [{ text: 'Native answer' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 5, cachedContentTokenCount: 30 } } }])
  }
  it.each([true, false])('serves Messages directly from Google (stream=%s)', stream => withRelay(async request => {
    mocks.key.allowedProviders = ['antigravity']
    mocks.accounts[0]!.metadata = { project: 'google-project' }
    mocks.fetch.mockResolvedValueOnce(nativeResponse())
    const response = await request({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'Hello' }], stream }, '/api/antigravity/v1/messages')
    expect(response.status).toBe(200)
    expect(response.body).toContain('Native answer')
    if (stream) expect(response.body).toContain('message_start')
    else expect(JSON.parse(response.body)).toMatchObject({ type: 'message', stop_reason: 'end_turn' })
    expect(mocks.fetch.mock.calls[0]?.[0]).toBe('https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse')
    expect(JSON.parse(mocks.fetch.mock.calls[0]?.[1].body)).toMatchObject({ project: 'google-project', model: 'claude-sonnet-5', request: { contents: [{ role: 'user', parts: [{ text: 'Hello' }] }] } })
    expect(mocks.logs[0]?.[4]).toBe('antigravity')
    expect(mocks.logs[0]?.slice(9, 12)).toEqual([70, 25, 5])
  }))

  it('routes an Antigravity-only key from the common Messages endpoint', () => withRelay(async request => {
    mocks.key.allowedProviders = ['antigravity']
    mocks.accounts[0]!.metadata = { project: 'project' }
    mocks.fetch.mockResolvedValueOnce(nativeResponse())
    expect((await request({ model: 'claude-sonnet-5', messages: [], stream: true }, '/v1/messages')).status).toBe(200)
    expect(mocks.pickAccount.mock.calls[0]?.[0]).toBe('antigravity')
  }))

  it.each(['/api/antigravity/v1beta/models/gemini-3.8-flash:generateContent', '/v1beta/models/gemini-3.8-flash:generateContent'])('unwraps native Gemini JSON at %s', url => withRelay(async request => {
    mocks.key.allowedProviders = ['antigravity']
    mocks.accounts[0]!.metadata = { project: 'project' }
    mocks.fetch.mockResolvedValueOnce(new Response('{"response":{"candidates":[{"content":{"parts":[{"text":"Gemini native","thoughtSignature":"sig"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":2}}}', { headers: { 'content-type': 'application/json' } }))
    const response = await request({ contents: [{ role: 'user', parts: [{ text: 'Hi' }] }] }, url)
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({ candidates: [{ content: { parts: [{ text: 'Gemini native', thoughtSignature: 'sig' }] } }] })
    expect(mocks.pickAccount.mock.calls[0]?.[0]).toBe('antigravity')
  }))

  it('returns an error and retains usage after an incomplete native Messages stream', () => withRelay(async request => {
    mocks.key.allowedProviders = ['antigravity']
    mocks.accounts[0]!.metadata = { project: 'project' }
    mocks.fetch.mockResolvedValueOnce(sse([{ response: { candidates: [{ content: { parts: [{ text: 'partial' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 } } }]))
    const response = await request({ model: 'claude-sonnet-5', messages: [], stream: false }, '/api/antigravity/v1/messages')
    expect(response.status).toBe(502)
    expect(mocks.logs[0]?.[22]).toBe('error')
    expect(mocks.logs[0]?.slice(9, 11)).toEqual([10, 2])
  }))

  it('uses cached model discovery only within the key account group', async () => {
    mocks.key.allowedProviders = ['antigravity']
    mocks.key.groupAllowedModels = ['gemini-*']
    mocks.key.accountGroupId = 'group-native'
    const app = Fastify()
    registerRelayRoutes(app)
    try {
      const response = await app.inject({ method: 'GET', url: '/api/antigravity/v1/models', headers: { authorization: 'Bearer mb-test' } })
      expect(response.statusCode).toBe(200)
      expect(response.json().data.map((item: { id: string }) => item.id)).toEqual(['gemini-3.8-flash'])
      expect(mocks.cachedAntigravityModels).toHaveBeenCalledWith('group-native')
    } finally { await app.close() }
  })
})

describe('stream first-frame latency', () => {
  /** Same wiring as withRelay, but hands the unread streamed Response to the test. */
  async function withStreamingRelay(
    run: (open: (payload: Record<string, unknown>, url?: string) => Promise<Response>) => Promise<void>,
  ): Promise<void> {
    const app = Fastify()
    registerRelayRoutes(app)
    const origin = await app.listen({ host: '127.0.0.1', port: 0 })
    try {
      await run(async (payload, url = '/v1/messages') => fetch(`${origin}${url}`, {
        method: 'POST', headers: { authorization: 'Bearer mb-test', 'content-type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(5_000),
      }))
    } finally {
      await app.close()
      await waitForPendingUsage()
    }
  }

  // Claude Code only resets its live tokens/s counter when `message_start`
  // reaches it, so anything the gateway awaits between the upstream's first
  // frame and its own first downstream write keeps the previous turn's rate
  // frozen on screen for exactly that long. Bookkeeping writes steer future
  // routing only — they must never sit on that path.
  it('forwards the first frame before the account bookkeeping write settles', () => withStreamingRelay(async (open) => {
    mocks.fetch.mockImplementation(async () => claudeResponse())
    let releaseBookkeeping!: () => void
    const blocked = new Promise<void>((resolve) => { releaseBookkeeping = resolve })
    let bookkeepingSettled = false
    mocks.markAccountUsed.mockImplementation(async () => {
      await blocked
      bookkeepingSettled = true
    })

    const response = await open({ model: 'claude-sonnet-5', messages: [], stream: true })
    expect(response.status).toBe(200)

    const first = await response.body!.getReader().read()
    expect(new TextDecoder().decode(first.value)).toContain('message_start')
    expect(bookkeepingSettled).toBe(false)

    releaseBookkeeping()
    await vi.waitFor(() => expect(mocks.markAccountUsed).toHaveBeenCalledWith('account-1'))
  }))
})
