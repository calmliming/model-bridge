import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'

const mocks = vi.hoisted(() => ({
  balance: 1_000, quota: 0, logs: [] as unknown[][], transactions: [] as unknown[][],
  cost: 0.01, key: {} as Record<string, unknown>,
  fetch: vi.fn(), query: vi.fn(), connect: vi.fn(),
  consumeSubscriptionUsage: vi.fn(), resolveActiveSubscription: vi.fn(),
  pickAccount: vi.fn(), markAccountUsed: vi.fn(), penalizeAccount: vi.fn(), penalizeAccountModel: vi.fn(),
  ensureFreshToken: vi.fn(),
  accounts: [] as Array<{ id: string; concurrencyLimit: number | null; metadata: Record<string, unknown> | null }>,
}))

vi.mock('../db/index', () => ({
  db: { update: () => ({ set: () => ({ where: async () => undefined }) }) },
  pool: { query: mocks.query, connect: mocks.connect },
}))
vi.mock('../keys/manager', () => ({
  findApiKeyBySecret: async () => ({ ...mocks.key, userBalanceMicros: mocks.balance }),
}))
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
