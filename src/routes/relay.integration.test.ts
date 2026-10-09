import { upstreamSignal } from '../http/cancellation'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'

const mocks = vi.hoisted(() => ({
  balance: 1_000, quota: 0, logs: [] as unknown[][], transactions: [] as unknown[][],
  cost: 0.01, key: {} as Record<string, unknown>,
  fetch: vi.fn(), query: vi.fn(), connect: vi.fn(),
  consumeSubscriptionUsage: vi.fn(), resolveActiveSubscription: vi.fn(),
  consumeWeightedSubscriptionUsage: vi.fn(),
  pickAccount: vi.fn(), markAccountUsed: vi.fn(), penalizeAccount: vi.fn(), penalizeAccountModel: vi.fn(),
  ensureFreshToken: vi.fn(),
  cachedAntigravityModels: vi.fn(),
  cachedAccountCatalogs: vi.fn(),
  resolvePrice: vi.fn(),
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
vi.mock('../usage/pricing', () => ({ calculateUsageCost: () => mocks.cost, estimateCost: () => mocks.cost, resolvePrice: (...args: unknown[]) => mocks.resolvePrice(...args), resolveUsagePrice: () => null }))
vi.mock('../subscriptions/manager', () => ({
  resolveActiveSubscription: mocks.resolveActiveSubscription,
  hasWindowHeadroom: async () => true,
  consumeSubscriptionUsage: mocks.consumeSubscriptionUsage,
  consumeWeightedSubscriptionUsage: mocks.consumeWeightedSubscriptionUsage,
}))
vi.mock('../http/upstream', () => ({ fetchWithConnectTimeout: mocks.fetch }))

import { registerRelayRoutes } from './relay'
import { waitForPendingUsage } from '../usage/recorder'
import { adjustWalletUsd } from '../wallet/manager'
import { resetLimits, currentConcurrency } from '../middleware/limits'
import { resetInflightReservations } from '../wallet/inflight'
import { resetCodexCatalogCache } from '../providers/openai/codexCatalog'
import { config } from '../config'

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
  mocks.fetch.mockReset()
  await resetLimits()
  resetInflightReservations()
  resetCodexCatalogCache()
  config.BALANCE_INFLIGHT_RESERVATION_ENABLED = false
  mocks.resolvePrice.mockReturnValue(null)
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
  mocks.consumeWeightedSubscriptionUsage.mockImplementation(async (_client, _id, points) => points)
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
  payload: Record<string, unknown>, url?: string, headers?: Record<string, string>,
) => Promise<{ status: number; contentType: string; body: string }>) => Promise<void>) {
  const app = Fastify()
  registerRelayRoutes(app)
  // Real loopback sockets cover hijacked streaming replies as well as JSON.
  const origin = await app.listen({ host: '127.0.0.1', port: 0 })
  try {
    await run(async (payload, url = '/v1/responses', headers = {}) => {
      const response = await fetch(`${origin}${url}`, {
        method: 'POST', headers: { authorization: 'Bearer mb-test', 'content-type': 'application/json', ...headers },
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

describe('GrsAI image relay', () => {
  it.each([false, true])('routes supplier-only keys on the standard path, stream=%s', async stream => {
    mocks.key.allowedProviders = ['grsai']
    mocks.key.accountGroupId = 'image-group'
    mocks.key.modelMappings = { picture: 'gpt-image-2.5-flare' }
    mocks.fetch.mockImplementation(async () => Response.json({ id: 'supplier-1', status: 'succeeded', results: [{ url: 'https://files.example.com/cat.png' }] }))
    await withRelay(async request => {
      const response = await request({ model: 'picture', prompt: 'cat', size: '1024x1024', response_format: 'url', stream }, '/v1/images/generations')
      expect(response.status).toBe(200)
      expect(mocks.pickAccount.mock.calls[0]![0]).toBe('grsai')
      expect(mocks.pickAccount.mock.calls[0]![3]).toBe('image-group')
      expect(JSON.parse(mocks.fetch.mock.calls[0]![1].body)).toMatchObject({ model: 'gpt-image-2.5-flare', aspectRatio: '1024x1024' })
      expect(mocks.logs[0]![4]).toBe('grsai')
      expect(mocks.logs[0]![16]).toBe(1)
      expect(response.body).toContain('https://files.example.com/cat.png')
      if (stream) expect(response.body).toContain('event: image_generation.completed')
    })
  })
  it('rejects supplier access and invalid parameters before any upstream call', async () => {
    mocks.key.allowedProviders = ['openai']
    await withRelay(async request => {
      expect((await request({ model: 'gpt-image-2', prompt: 'cat' }, '/api/grsai/v1/images/generations')).status).toBe(403)
      mocks.key.allowedProviders = ['grsai']
      expect((await request({ model: 'gpt-image-2', prompt: 'cat', n: 2 }, '/api/grsai/v1/images/generations')).status).toBe(400)
      expect(mocks.fetch).not.toHaveBeenCalled()
    })
  })
  it('does not duplicate a paid generation after a network timeout', async () => {
    mocks.key.allowedProviders = ['grsai']
    mocks.fetch.mockRejectedValue(new Error('request timed out'))
    await withRelay(async request => {
      const response = await request({ model: 'gpt-image-2', prompt: 'cat' }, '/api/grsai/v1/images/generations')
      expect(response.status).toBe(502)
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
    })
  })
})

const prompt = { model: 'gpt-5.4', stream: true, input: 'Hi' }

describe('weighted subscription relay settlement', () => {
  it.each([
    ['/v1/responses', false], ['/v1/responses', true],
    ['/v1/chat/completions', false], ['/v1/chat/completions', true],
    ['/api/claude/v1/messages', false], ['/api/claude/v1/messages', true],
  ] as const)('keeps the subscription meter through %s stream=%s', (url, stream) => withRelay(async request => {
    mocks.key.accountGroupId = 'group-1'
    mocks.resolveActiveSubscription.mockResolvedValue({ subscriptionId: 'sub-1', quotaMode: 'usage', usageWindows: [{ remaining: 100 }] })
    const anthropic = url.includes('/messages')
    if (anthropic) mocks.fetch.mockImplementation(async () => claudeResponse())
    const result = await request({ model: anthropic ? 'claude-sonnet-5' : 'gpt-5.4', stream,
      input: 'Hi', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 100 }, url)
    expect(result.status).toBe(200)
    expect(mocks.consumeWeightedSubscriptionUsage).toHaveBeenCalledWith(expect.anything(), 'sub-1', 10, expect.any(Number), expect.any(String))
    expect(mocks.consumeSubscriptionUsage).not.toHaveBeenCalled()
    expect(mocks.transactions).toHaveLength(0)
    expect(mocks.balance).toBe(1000)
    expect(mocks.logs[0]?.slice(37, 39)).toEqual(['sub-1', 10])
  }))
})

describe('Claude Code safeguard protocol passthrough', () => {
  const routes = [
    { url: '/api/claude/v1/messages?beta=true', provider: 'claude' },
    { url: '/v1/messages?beta=true', provider: 'claude' },
    { url: '/api/sub2api/v1/messages?beta=true', provider: 'sub2api' },
    { url: '/v1/messages?beta=true', provider: 'sub2api' },
  ]

  it.each(routes.flatMap(route => [false, true].map(stream => ({ ...route, stream }))))(
    'preserves requests and verdicts on $provider $url with stream=$stream',
    ({ url, provider, stream }) => withRelay(async request => {
      mocks.key.allowedProviders = [provider]
      mocks.accounts[0]!.proxyUrl = 'https://gateway.example/v1'
      const toolId = 'toolu_original_safeguard_id'
      // Opaque fixtures: the gateway must not depend on a particular version
      // of the safeguards schema or reinterpret an upstream denial.
      const results = [{ tool_use_id: toolId, decision: 'deny', future_detail: { reason: 'test denial' } }]
      const message = {
        id: 'msg_safeguards', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
        content: [{ type: 'tool_use', id: toolId, name: 'Bash', input: { command: 'pwd' } }],
        stop_reason: 'tool_use', safeguard_results: results,
        usage: { input_tokens: 100, output_tokens: 7 }, future_response_field: { preserved: true },
      }
      const events = [
        { type: 'message_start', message: { ...message, content: [], usage: { input_tokens: 100 } } },
        { type: 'content_block_start', index: 0, content_block: message.content[0] },
        { type: 'content_block_stop', index: 0, safeguard_results: results },
        { type: 'message_delta', delta: { stop_reason: 'tool_use', safeguard_results: results }, usage: { output_tokens: 7 } },
        { type: 'message_stop' },
        { type: 'future_safeguard_event', safeguard_results: results },
      ]
      const responseText = stream
        ? ': upstream keepalive\n\nevent: ping\ndata: {"type":"ping"}\n\n' +
          events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
        : JSON.stringify(message)
      const bytes = new TextEncoder().encode(responseText)
      mocks.fetch.mockResolvedValueOnce(new Response(new ReadableStream({
        start(controller) {
          // Split inside JSON and SSE separators to exercise stream framing.
          for (let offset = 0; offset < bytes.length; offset += 31) controller.enqueue(bytes.slice(offset, offset + 31))
          controller.close()
        },
      }), { headers: { 'content-type': stream ? 'text/event-stream' : 'application/json' } }))
      const payload = {
        model: 'claude-opus-5-5', stream,
        safeguards: { future_setting: { enabled: true } }, future_request_field: { preserved: true },
        system: [{ type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.281; cch=original;' }],
        tools: [{ name: 'Bash', input_schema: { type: 'object' } }],
        messages: [
          { role: 'assistant', content: [{ type: 'tool_use', id: toolId, name: 'Bash', input: { command: 'pwd' } }] },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: '/workspace' }] },
        ],
      }
      const beta = 'future-safeguards-test, future-capability-test'
      const response = await request(payload, url, {
        'anthropic-beta': beta, 'anthropic-version': '2023-06-01',
        'user-agent': 'claude-cli/2.1.281 (external, cli)', 'x-api-key': 'mb-client-secret',
      })
      expect(response.status).toBe(200)
      expect(response.body).toBe(responseText)
      expect(response.contentType).toContain(stream ? 'text/event-stream' : 'application/json')
      const [upstreamUrl, init] = mocks.fetch.mock.calls[0]!
      expect(upstreamUrl).toBe(provider === 'claude'
        ? 'https://api.anthropic.com/v1/messages' : 'https://gateway.example/v1/messages')
      expect(JSON.parse(init.body)).toEqual(payload)
      const sentHeaders = new Headers(init.headers)
      expect(sentHeaders.get('anthropic-beta')?.startsWith(beta)).toBe(true)
      expect(sentHeaders.get('anthropic-version')).toBe('2023-06-01')
      expect(sentHeaders.get('authorization')).toBe('Bearer test-upstream-token')
      expect(sentHeaders.get('x-api-key')).toBe(provider === 'sub2api' ? 'test-upstream-token' : null)
      expect(mocks.logs).toHaveLength(1)
      expect(mocks.logs[0]?.slice(9, 11)).toEqual([100, 7])
      expect(mocks.quota).toBe(mocks.cost)
    }),
  )

  it.each([false, true])('does not invent a verdict for an unsupported upstream with stream=%s', stream => withRelay(async request => {
    mocks.fetch.mockResolvedValueOnce(stream ? claudeResponse() : new Response(JSON.stringify({
      id: 'msg_without_safeguards', content: [], usage: { input_tokens: 100, output_tokens: 100 },
    }), { headers: { 'content-type': 'application/json' } }))
    const response = await request({ model: 'claude-sonnet-5', stream, messages: [], safeguards: {} }, '/v1/messages', {
      'anthropic-beta': 'future-safeguards-test',
    })
    expect(response.status).toBe(200)
    expect(response.body).not.toContain('safeguard_results')
    expect(mocks.quota).toBe(mocks.cost)
  }))
})

describe('Sub2API converted Messages usage', () => {
  it('records input and cache counts that only arrive in the final message_delta', () => withRelay(async request => {
    mocks.key.allowedProviders = ['sub2api']
    mocks.accounts[0]!.proxyUrl = 'https://gateway.example/v1'
    // Sub2API serving a GPT account over Messages: message_start reports 0.
    mocks.fetch.mockResolvedValueOnce(sse([
      { type: 'message_start', message: { id: 'msg_gpt', model: 'gpt-6-sol', usage: { input_tokens: 0, output_tokens: 0 } } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0 } },
      { type: 'message_stop' },
    ]))
    const response = await request({ model: 'gpt-6-sol', stream: true, max_tokens: 64, messages: [{ role: 'user', content: 'Hi' }] }, '/v1/messages')
    expect(response.status).toBe(200)
    expect(mocks.logs).toHaveLength(1)
    // input, output, reasoning, cache create, cache read
    expect(mocks.logs[0]?.slice(9, 14)).toEqual([1200, 80, 0, 0, 3000])
    expect(mocks.logs[0]?.[36]).toBe('upstream')
  }))
})

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

  it('drops settings Sonnet 5.5 rejects before calling Anthropic', () => withRelay(async (request) => {
    mocks.fetch.mockImplementation(async () => claudeResponse())
    const response = await request({
      model: 'claude-sonnet-5-5', stream: true, temperature: 0.3, top_p: 0.8, tool_choice: 'required',
      tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object', properties: {} } } }],
      messages: [{ role: 'user', content: 'Hi' }],
    }, '/api/claude/v1/chat/completions')
    expect(response.status).toBe(200)
    const sent = JSON.parse(mocks.fetch.mock.calls[0]![1].body)
    expect(sent).not.toHaveProperty('temperature')
    expect(sent).not.toHaveProperty('top_p')
    expect(sent.tool_choice).toEqual({ type: 'auto' })
    expect(sent.tools[0]).toMatchObject({ name: 'lookup', strict: true })
  }))

  it.each([
    ['claude-sonnet-5-5', false],
    ['claude-sonnet-5', true],
  ])('handles the fine-grained streaming beta with computer toolsets on %s', (model, kept) => withRelay(async (request) => {
    mocks.key.allowedProviders = ['claude']
    mocks.fetch.mockImplementation(async () => claudeResponse())
    const response = await request({
      model, stream: true, max_tokens: 64,
      tools: [{ type: 'computer_toolset_20260801', name: 'computer' }],
      messages: [{ role: 'user', content: 'Hi' }],
    }, '/v1/messages', { 'anthropic-beta': 'fine-grained-tool-streaming-2025-05-14,future-capability-test' })
    expect(response.status).toBe(200)
    const beta = new Headers(mocks.fetch.mock.calls[0]![1].headers).get('anthropic-beta')!.split(',')
    expect(beta.includes('fine-grained-tool-streaming-2025-05-14')).toBe(kept)
    expect(beta).toContain('future-capability-test')
    expect(beta).toContain('oauth-2025-04-20')
  }))
})

describe('balance in-flight reservation', () => {
  function deferredUpstream() {
    let resolve!: (response: Response) => void
    const pending = new Promise<Response>(done => { resolve = done })
    return { pending, resolve }
  }

  it('rejects a concurrent request once in-flight reservations cover the balance', () => withRelay(async (request) => {
    config.BALANCE_INFLIGHT_RESERVATION_ENABLED = true
    // $10 / $100 per 1M: a 100-output-token request reserves well over 1,000 micros.
    mocks.resolvePrice.mockReturnValue({ input: 10, output: 100, cacheWrite: 0, cacheRead: 0 })
    const first = deferredUpstream()
    let started!: () => void
    const upstreamStarted = new Promise<void>(done => { started = done })
    mocks.fetch.mockImplementationOnce(async () => { started(); return first.pending })
    const body = { ...prompt, max_output_tokens: 100 }
    const firstRequest = request(body)
    await upstreamStarted
    const second = await request(body)
    expect(second.status).toBe(402)
    expect(JSON.parse(second.body).error).toContain('in-flight')
    first.resolve(openaiResponse())
    expect((await firstRequest).status).toBe(200)
    // The reservation is released after settlement.
    mocks.balance = 1_000_000
    mocks.fetch.mockImplementation(async () => openaiResponse())
    expect((await request(body)).status).toBe(200)
  }))

  it('admits concurrent requests while disabled or when the model is unpriced', () => withRelay(async (request) => {
    for (const enabled of [false, true]) {
      config.BALANCE_INFLIGHT_RESERVATION_ENABLED = enabled
      mocks.resolvePrice.mockReturnValue(enabled ? null : { input: 10, output: 100, cacheWrite: 0, cacheRead: 0 })
      const first = deferredUpstream()
      let started!: () => void
      const upstreamStarted = new Promise<void>(done => { started = done })
      mocks.fetch.mockImplementationOnce(async () => { started(); return first.pending })
      mocks.fetch.mockImplementationOnce(async () => openaiResponse())
      const firstRequest = request({ ...prompt, max_output_tokens: 100 })
      await upstreamStarted
      expect((await request({ ...prompt, max_output_tokens: 100 })).status).toBe(200)
      first.resolve(openaiResponse())
      expect((await firstRequest).status).toBe(200)
      mocks.balance = 1_000
    }
  }))
})

describe('Codex remote model catalog', () => {
  async function get(url: string) {
    const app = Fastify()
    registerRelayRoutes(app)
    try {
      return await app.inject({ method: 'GET', url, headers: { authorization: 'Bearer mb-test' } })
    } finally {
      await app.close()
    }
  }
  const manifest = { models: [{ slug: 'gpt-6-sol', display_name: 'GPT-6 Sol', priority: 1 }, { slug: 'gpt-5.4', priority: 2 }, { name: 'no-slug' }], etag: 'v1' }

  it('serves the upstream manifest filtered to the key and caches it briefly', async () => {
    mocks.key.allowedModels = ['gpt-6*']
    mocks.accounts[0]!.metadata = { openai: { chatgptAccountId: 'acct-123' } }
    mocks.fetch.mockImplementation(async () => new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/json' } }))
    const response = await get('/v1/models?client_version=0.158.0')
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ models: [manifest.models[0]], etag: 'v1' })
    const [url, init] = mocks.fetch.mock.calls[0]!
    expect(url).toBe('https://chatgpt.com/backend-api/codex/models?client_version=0.158.0')
    expect(init.headers).toMatchObject({ authorization: 'Bearer test-upstream-token', 'ChatGPT-Account-ID': 'acct-123' })
    expect((await get('/api/openai/v1/models?client_version=0.158.0')).statusCode).toBe(200)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps the OpenAI-style list without a client version and rejects keys without OpenAI', async () => {
    const list = await get('/v1/models')
    expect(list.json()).toMatchObject({ object: 'list' })
    expect(mocks.fetch).not.toHaveBeenCalled()
    mocks.key.allowedProviders = ['deepseek']
    expect((await get('/v1/models?client_version=0.158.0')).statusCode).toBe(403)
  })

  it('reports an upstream failure without caching it', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response('busy', { status: 500 }))
    expect((await get('/v1/models?client_version=0.158.0')).statusCode).toBe(502)
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify(manifest)))
    expect((await get('/v1/models?client_version=0.158.0')).statusCode).toBe(200)
  })
})

describe('Codex request headers', () => {
  it('forwards the caller multi-agent beta to the Codex backend', () => withRelay(async (request) => {
    const response = await request(prompt, '/v1/responses', { 'openai-beta': 'responses_multi_agent=v1' })
    expect(response.status).toBe(200)
    expect(new Headers(mocks.fetch.mock.calls[0]![1].headers).get('openai-beta')).toBe('responses_multi_agent=v1')
  }))

  it('keeps the default beta for callers that send none', () => withRelay(async (request) => {
    expect((await request(prompt)).status).toBe(200)
    expect(new Headers(mocks.fetch.mock.calls[0]![1].headers).get('openai-beta')).toBe('responses=experimental')
  }))

  it('rejects an unsupported GPT-6.1 Sol effort without penalizing the account', () => withRelay(async (request) => {
    const response = await request({ model: 'gpt-6.1-sol', stream: true, input: 'Hi', reasoning: { effort: 'none' } })
    expect(response.status).toBe(400)
    expect(JSON.parse(response.body).error.code).toBe('unsupported_reasoning_effort')
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.penalizeAccount).not.toHaveBeenCalled()
  }))
})

describe('upstream request compatibility', () => {
  it.each([false, true])('routes Image 2.5 directly and records cache/image buckets for stream=%s', stream => withRelay(async request => {
    const model = 'gpt-image-2.5-sunburst'
    const usage = { input_tokens: 1000, output_tokens: 500, input_tokens_details: { image_tokens: 600, cached_tokens: 300, cached_tokens_details: { image_tokens: 200, text_tokens: 100 } } }
    mocks.accounts[0]!.metadata = { openai: { chatgptAccountId: 'account-image' } }
    mocks.fetch.mockResolvedValueOnce(stream ? sse([{ type: 'image_generation.partial_image', b64_json: 'AAAA', partial_image_index: 0 },
      { type: 'image_generation.completed', b64_json: 'BBBB', usage }]) : new Response(JSON.stringify({ created: 1, data: [{ b64_json: 'BBBB' }], usage }), { headers: { 'content-type': 'application/json' } }))
    const response = await request({ model, prompt: 'Draw a tree', stream, quality: 'max', background: 'transparent', output_format: 'png' }, '/v1/images/generations')
    expect(response.status).toBe(200)
    expect(mocks.fetch.mock.calls[0]?.[0]).toBe('https://chatgpt.com/backend-api/codex/images/generations')
    const sent = JSON.parse(mocks.fetch.mock.calls[0]?.[1].body)
    expect(sent).toMatchObject({ model, prompt: 'Draw a tree', quality: 'max', background: 'transparent' })
    expect(sent).not.toHaveProperty('tools')
    expect(response.body).toContain('BBBB')
    if (stream) expect(response.body).toContain('image_generation.completed')
    const log = mocks.logs[0]!
    expect(log.slice(9, 17)).toEqual([300, 0, 0, 0, 100, 400, 500, 1])
    expect(log[35]).toBe(200)
    expect(log[22]).toBe('success')
    expect(mocks.logs).toHaveLength(1)
  }))

  it('keeps native editing, alias mapping, and group admission consistent', () => withRelay(async request => {
    mocks.balance = 100_000
    mocks.key.modelMappings = { 'image-public': 'gpt-image-2.5-flare' }
    mocks.key.groupAllowedModels = ['image-public']
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: 'AAAA' }] }), { headers: { 'content-type': 'application/json' } }))
    const response = await request({ model: 'image-public', prompt: 'Edit', images: [{ image_url: 'data:image/png;base64,AAAA' }], quality: 'xhigh' }, '/v1/images/edits')
    expect(response.status).toBe(200)
    expect(mocks.fetch.mock.calls[0]?.[0]).toBe('https://chatgpt.com/backend-api/codex/images/edits')
    expect(JSON.parse(mocks.fetch.mock.calls[0]?.[1].body)).toMatchObject({ model: 'gpt-image-2.5-flare', images: [{ image_url: 'data:image/png;base64,AAAA' }] })
    expect((await request({ model: 'gpt-image-2.5-flare', prompt: 'Blocked' }, '/v1/images/generations')).status).toBe(404)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  }))

  it('retries an empty native result but does not replay billed failures', () => withRelay(async request => {
    mocks.balance = 100_000
    mocks.accounts.push({ id: 'account-2', concurrencyLimit: null, metadata: null })
    mocks.fetch.mockResolvedValueOnce(new Response('{"data":[]}', { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('{"data":[{"b64_json":"AAAA"}]}', { headers: { 'content-type': 'application/json' } }))
    expect((await request({ model: 'gpt-image-2.5-flare', prompt: 'Draw' }, '/v1/images/generations')).status).toBe(200)
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    mocks.fetch.mockClear()
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded', message: 'Stopped' }, usage: { input_tokens: 10, output_tokens: 20 } }), { status: 429, headers: { 'content-type': 'application/json' } }))
    expect((await request({ model: 'gpt-image-2.5-flare', prompt: 'Draw' }, '/v1/images/generations')).status).toBe(429)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.logs.at(-1)?.[15]).toBe(20)
  }))

  it('reports a native stream without a final image as failure and retains usage', () => withRelay(async request => {
    mocks.fetch.mockResolvedValueOnce(sse([{ type: 'image_generation.partial_image', b64_json: 'AAAA', usage: { input_tokens: 10, output_tokens: 20 } }]))
    const response = await request({ model: 'gpt-image-2.5-flare', prompt: 'Draw', stream: true }, '/v1/images/generations')
    expect(response.body).toContain('image_generation_no_output')
    expect(mocks.logs[0]?.[22]).toBe('error')
    expect(mocks.logs[0]?.[15]).toBe(20)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  }))

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
    { provider: 'xiaomi', model: 'mimo-v2.6-pro', upstream: 'https://api.xiaomimimo.com/v1/chat/completions' },
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
  it.each([
    '/v1/responses', '/api/deepseek/v1/responses',
    '/v1/chat/completions', '/api/deepseek/v1/chat/completions',
    '/v1/messages', '/api/deepseek/v1/messages',
  ])('normalizes DeepSeek long-context selectors before forwarding and billing at %s', (url) => withRelay(async request => {
    mocks.key.allowedProviders = ['deepseek']
    if (url.endsWith('/messages')) {
      mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'msg_deepseek', type: 'message', role: 'assistant', model: 'deepseek-flash',
        content: [{ type: 'text', text: 'Hello' }], stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 20 },
      }), { headers: { 'content-type': 'application/json' } }))
    }
    const response = await request({
      model: 'DeepSeek-FLASH[1M][1m]', stream: false, max_tokens: 100,
      ...(url.endsWith('/responses') ? { input: 'Hello' } : { messages: [{ role: 'user', content: 'Hello' }] }),
    }, url)
    expect(response.status).toBe(200)
    expect(JSON.parse(mocks.fetch.mock.calls[0]?.[1].body).model).toBe('deepseek-flash')
    expect(mocks.logs[0]?.slice(4, 6)).toEqual(['deepseek', 'deepseek-flash'])
  }))

  it.each([
    ['/v1/messages', 'mimo-v2.5-pro', 'mimo-v2.6-pro'], ['/api/xiaomi/v1/messages', 'mimo-v2.5', 'mimo-v2.6-flash'],
    ['/v1/chat/completions', 'mimo-v2.5', 'mimo-v2.6-flash'], ['/api/xiaomi/v1/chat/completions', 'mimo-v2.5-pro', 'mimo-v2.6-pro'],
    ['/v1/responses', 'mimo-v2.5-pro', 'mimo-v2.6-pro'], ['/api/xiaomi/v1/responses', 'mimo-v2.5', 'mimo-v2.6-flash'],
  ])('forwards and bills retired MiMo names as their successor at %s', (url, model, successor) => withRelay(async request => {
    mocks.key.allowedProviders = ['xiaomi']
    if (url.endsWith('/messages')) {
      mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'msg_mimo', type: 'message', role: 'assistant', model: successor,
        content: [{ type: 'text', text: 'Hello' }], stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 20 },
      }), { headers: { 'content-type': 'application/json' } }))
    } else if (url.endsWith('/responses')) {
      mocks.fetch.mockResolvedValueOnce(sse([
        { choices: [{ delta: { content: 'Hello' }, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } },
      ]))
    }
    const response = await request({
      model, stream: false, max_tokens: 100,
      ...(url.endsWith('/responses') ? { input: 'Hello' } : { messages: [{ role: 'user', content: 'Hello' }] }),
    }, url)
    expect(response.status).toBe(200)
    expect(JSON.parse(mocks.fetch.mock.calls[0]?.[1].body).model).toBe(successor)
    expect(mocks.logs[0]?.slice(4, 6)).toEqual(['xiaomi', successor])
  }))

  it.each(['/v1/messages', '/v1/chat/completions', '/v1/responses'])(
    'rejects normalized unknown DeepSeek models without forwarding at %s', url => withRelay(async request => {
      mocks.key.allowedProviders = ['deepseek']
      const response = await request({ model: 'DEEPSEEK-TYPO[1m]', input: 'Hello', messages: [], max_tokens: 100 }, url)
      expect(response.status).toBe(400)
      expect(JSON.parse(response.body)).toMatchObject({ error: { type: 'invalid_request_error', code: 'invalid_deepseek_model' } })
      expect(mocks.fetch).not.toHaveBeenCalled()
      expect(mocks.pickAccount).not.toHaveBeenCalled()
    })
  )

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
  it.each([
    ['/v1/responses', true], ['/v1/chat/completions', true], ['/v1/chat/completions', false],
  ] as const)('settles a terminal without waiting for upstream EOF at %s (stream=%s)', (url, stream) => withRelay(async request => {
    const cancel = vi.fn()
    const terminal = { type: 'response.completed', response: { id: 'resp_done', model: 'gpt-5.4',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Done' }] }],
      usage: { input_tokens: 100, output_tokens: 20 } } }
    const bytes = new TextEncoder().encode(`data: ${JSON.stringify(terminal)}\r\n\r\ndata: {"type":"error","error":{"message":"late"}}\r\n\r\n`)
    mocks.fetch.mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7))
        // Intentionally never close: EOF used to keep the request and billing open.
      }, cancel,
    }), { headers: { 'content-type': 'text/event-stream' } }))
    const response = await request({ model: 'gpt-5.4', stream, messages: [{ role: 'user', content: 'Hi' }], input: 'Hi' }, url)
    expect(response.status).toBe(200)
    expect(response.body).not.toContain('late')
    expect(cancel).toHaveBeenCalledOnce()
    expect(mocks.logs).toHaveLength(1)
    expect(mocks.logs[0]?.slice(9, 11)).toEqual([100, 20])
    expect(mocks.logs[0]?.[22]).toBe('success')
    expect(mocks.quota).toBe(mocks.cost)
  }))

  it.each(['/v1/responses', '/v1/chat/completions'])('sends a protocol error once at %s', url => withRelay(async request => {
    const error = { type: 'error', error: { code: 'server_error', message: 'failed once', status: 503 } }
    mocks.fetch.mockResolvedValueOnce(sse([error, error, { type: 'response.completed', response: { usage: { output_tokens: 999 } } }]))
    const response = await request({ ...prompt, stream: true }, url)
    expect(response.body.match(/failed once/g)).toHaveLength(1)
    expect(response.body).not.toContain('999')
    expect(mocks.logs).toHaveLength(1)
    expect(mocks.logs[0]?.[22]).toBe('error')
  }))

  it('sanitizes native Messages schemas without touching tool input data', () => withRelay(async request => {
    mocks.fetch.mockResolvedValueOnce(claudeResponse())
    const messages = [{ role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'tool', input: { required: null } }] }]
    const response = await request({ model: 'kimi-k2.5', stream: true, messages,
      tools: [{ name: 'tool', input_schema: { type: 'object', required: null, properties: { value: { type: 'object', required: null } } } }],
    }, '/api/kimi/v1/messages')
    expect(response.status).toBe(200)
    const body = JSON.parse(mocks.fetch.mock.calls[0]![1].body)
    expect(body.tools[0].input_schema).toEqual({ type: 'object', properties: { value: { type: 'object' } } })
    expect(body.messages).toEqual(messages)
  }))

  it.each([false, true])('resolves native Antigravity models before stripped thinking budgets (Messages=%s)', messages => withRelay(async request => {
    mocks.accounts[0]!.metadata = { project: 'project-1', antigravityModels: [
      { id: 'gemini-3.8-flash-low' }, { id: 'gemini-3.8-flash-high' },
    ] }
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: 'Hello' }] }, finishReason: 'STOP' }] } }),
      { headers: { 'content-type': 'application/json' } }))
    const response = await request(messages
      ? { model: 'gemini-3.8-flash', stream: false, messages: [], thinking: { type: 'enabled', budget_tokens: 512 } }
      : { contents: [], generationConfig: { thinkingConfig: { thinkingBudget: 512 } } },
    messages ? '/api/antigravity/v1/messages' : '/api/antigravity/v1beta/models/gemini-3.8-flash:generateContent')
    expect(response.status).toBe(200)
    expect(JSON.parse(mocks.fetch.mock.calls[0]![1].body).model).toBe('gemini-3.8-flash-low')
  }))

  it.each(['gl-python/3.12', 'gl-go/1.25', 'gl-node/22'])('keeps Gemini SSE compatible with %s', language => withRelay(async request => {
    mocks.accounts[0]!.metadata = { project: 'project-1' }
    const payload = { response: { candidates: [{ content: { parts: [{ text: 'Done' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10 } } }
    mocks.fetch.mockResolvedValueOnce(new Response(`: upstream heartbeat\n\ndata: ${JSON.stringify(payload)}\n\n`,
      { headers: { 'content-type': 'text/event-stream' } }))
    const interval = vi.spyOn(globalThis, 'setInterval')
    try {
      const response = await request({ contents: [] }, '/api/antigravity/v1beta/models/gemini-3.8-flash:streamGenerateContent',
        { 'x-goog-api-client': `google-genai-sdk/1.71.0 ${language}` })
      expect(response.status).toBe(200)
      expect(response.body).toContain('Done')
      const supportsComments = language.startsWith('gl-node')
      expect(response.body.includes(': upstream heartbeat')).toBe(supportsComments)
      expect(interval.mock.calls.some(([, ms]) => ms === 15_000)).toBe(supportsComments)
    } finally {
      interval.mockRestore()
    }
  }))

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
  it.each([{ headersSent: false, adapter: false }, { headersSent: true, adapter: false },
    { headersSent: false, adapter: true }, { headersSent: true, adapter: true }])('aborts upstream and releases all slots after disconnect (headers: $headersSent, adapter: $adapter)', async ({ headersSent, adapter }) => {
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
        const firstEvent = adapter ? { choices: [{ delta: { content: 'partial' } }], usage: { prompt_tokens: 42 } }
          : { type: 'message_start', message: { usage: { input_tokens: 42 } } }
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(firstEvent)}\n\n`))
        signal.addEventListener('abort', () => { canceled = true; controller.error(signal.reason) }, { once: true })
      } }), { headers: { 'content-type': 'text/event-stream' } })
    })
    const app = Fastify()
    registerRelayRoutes(app)
    const origin = await app.listen({ host: '127.0.0.1', port: 0 })
    const client = new AbortController()
    try {
      const pending = fetch(`${origin}${adapter ? '/api/qwen/v1/responses' : '/v1/messages'}`, {
        method: 'POST', headers: { authorization: 'Bearer mb-test', 'content-type': 'application/json' },
        body: JSON.stringify(adapter ? { model: 'qwen3.8-max', stream: true, input: 'Hello' }
          : { model: 'claude-sonnet-5', stream: true, messages: [{ role: 'user', content: 'Hello' }] }),
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
      expect(mocks.logs).toHaveLength(1)
      expect(mocks.logs[0]?.[36]).toBe(headersSent ? 'partial' : 'missing')
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
  const privateErrorMessage = 'Permission denied for projects/private-project-42; '
    + 'pool-bot@private-project-42.iam.gserviceaccount.com; consumer: 123456789012; '
    + 'project number 987654321012; https://internal.example/error?key=private-key'
  const privateError = (code: number) => ({ error: { code, message: privateErrorMessage,
    status: code === 429 ? 'RESOURCE_EXHAUSTED' : code === 400 ? 'INVALID_ARGUMENT' : 'PERMISSION_DENIED',
    details: [{ metadata: { consumer: 'projects/private-project-42', serviceAccount: 'pool-bot@private-project-42.iam.gserviceaccount.com',
      internalOnly: 'private-details-value' } }] } })
  function expectNoAccountIdentity(text: string) {
    for (const privateValue of ['private-project-42', 'gserviceaccount.com', '123456789012', '987654321012',
      'internal.example', 'private-key', 'private-details-value']) expect(text).not.toContain(privateValue)
  }
  const errorEndpoints = [
    { protocol: 'Messages', stream: false, url: '/api/antigravity/v1/messages' },
    { protocol: 'Messages', stream: true, url: '/v1/messages' },
    { protocol: 'Gemini', stream: false, url: '/api/antigravity/v1beta/models/gemini-3.8-flash:generateContent' },
    { protocol: 'Gemini', stream: true, url: '/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse' },
  ]

  it.each(errorEndpoints.flatMap(endpoint => [400, 403, 429].map(status => ({ ...endpoint, status }))))(
    'sanitizes HTTP $status errors for $protocol, stream=$stream', ({ protocol, stream, url, status }) => withRelay(async request => {
      mocks.key.allowedProviders = ['antigravity']
      mocks.accounts = [1, 2, 3].map(n => ({ id: `account-${n}`, concurrencyLimit: null, metadata: { project: 'private-project-42' } }))
      mocks.fetch.mockImplementation(async () => Response.json(privateError(status), { status }))
      const response = await request(protocol === 'Messages'
        ? { model: 'claude-sonnet-5', messages: [], stream } : { contents: [], stream }, url)
      expect(response.status).toBe(status)
      expect(response.contentType).toContain('application/json')
      const body = JSON.parse(response.body)
      expect(body.error.message).toContain('Permission denied')
      expect(body.error.details).toBeUndefined()
      if (protocol === 'Gemini') expect(body.error).toMatchObject({ code: status, status: privateError(status).error.status })
      else expect(body).toMatchObject({ type: 'error', error: { type: 'upstream_error', code: privateError(status).error.status } })
      expectNoAccountIdentity(response.body)
      expect(mocks.logs).toHaveLength(1)
      expect(mocks.logs[0]?.[22]).toBe('error')
      expect(mocks.logs[0]?.[25]).toBe(status)
      expectNoAccountIdentity(String(mocks.logs[0]?.[24]))
    }),
  )

  it('returns valid sanitized JSON for a non-JSON HTTP error on a streaming request', () => withRelay(async request => {
    mocks.key.allowedProviders = ['antigravity']
    mocks.accounts[0]!.metadata = { project: 'private-project-42' }
    mocks.fetch.mockImplementation(async () => new Response(privateErrorMessage, { status: 403, headers: { 'content-type': 'text/plain' } }))
    const response = await request({ model: 'claude-sonnet-5', messages: [], stream: true }, '/v1/messages')
    expect(response.status).toBe(403)
    expect(JSON.parse(response.body)).toMatchObject({ type: 'error', error: { code: 'upstream_403' } })
    expectNoAccountIdentity(response.body)
  }))

  it.each([false, true])('sanitizes embedded Gemini errors without losing billable usage, stream=%s', stream => withRelay(async request => {
    mocks.key.allowedProviders = ['antigravity']
    mocks.accounts[0]!.metadata = { project: 'private-project-42' }
    const response = { ...privateError(403), project: 'private-project-42',
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 5, cachedContentTokenCount: 20, thoughtsTokenCount: 3 } }
    mocks.fetch.mockImplementation(async () => stream
      ? new Response(`: private-project-42\n\ndata: ${JSON.stringify({ response }, null, 2).split('\n').join('\ndata: ')}\n\n`
        + `data: malformed private-project-42 pool-bot@private-project-42.iam.gserviceaccount.com\n\n`,
      { headers: { 'content-type': 'text/event-stream' } })
      : Response.json({ response }))
    const result = await request({ contents: [] }, `/api/antigravity/v1beta/models/gemini-3.8-flash:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`)
    expect(result.status).toBe(200)
    expect(result.body).toContain('PERMISSION_DENIED')
    expect(result.body).not.toContain('details')
    expectNoAccountIdentity(result.body)
    expect(mocks.logs).toHaveLength(1)
    expect(mocks.logs[0]?.[22]).toBe('error')
    expect(mocks.logs[0]?.slice(9, 12)).toEqual([80, 8, 3])
    expectNoAccountIdentity(String(mocks.logs[0]?.[24]))
  }))

  it('sanitizes a final Gemini error frame without a trailing separator', () => withRelay(async request => {
    mocks.key.allowedProviders = ['antigravity']
    mocks.accounts[0]!.metadata = { project: 'private-project-42' }
    mocks.fetch.mockImplementation(async () => new Response(`data: ${JSON.stringify({ response: privateError(403) })}`,
      { headers: { 'content-type': 'text/event-stream' } }))
    const response = await request({ contents: [] }, '/v1beta/models/gemini-3.8-flash:streamGenerateContent')
    expect(response.status).toBe(200)
    expect(response.body).toContain('PERMISSION_DENIED')
    expectNoAccountIdentity(response.body)
    expect(mocks.logs[0]?.[22]).toBe('error')
  }))

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

  function malformedResponse() {
    return sse([{ response: { candidates: [{ content: { parts: [{ thoughtSignature: 'sig-only' }] }, finishReason: 'MALFORMED_FUNCTION_CALL' }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 0 } } }])
  }

  it.each([true, false])('retries an empty MALFORMED_FUNCTION_CALL reply before the client sees it (stream=%s)', stream => withRelay(async request => {
    mocks.key.allowedProviders = ['antigravity']
    mocks.accounts[0]!.metadata = { project: 'google-project' }
    mocks.fetch.mockResolvedValueOnce(malformedResponse()).mockResolvedValueOnce(nativeResponse())
    const response = await request({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'Hello' }], stream }, '/api/antigravity/v1/messages')
    expect(response.status).toBe(200)
    expect(response.body).toContain('Native answer')
    expect(response.body).not.toContain('MALFORMED_FUNCTION_CALL')
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    // The flake is not an account fault: no penalty, and the only account is reused.
    expect(mocks.penalizeAccount).not.toHaveBeenCalled()
    expect(mocks.pickAccount).toHaveBeenCalledTimes(2)
    expect(mocks.logs).toHaveLength(1)
    expect(mocks.logs[0]?.[26]).toBe(2) // attempt_count
  }))

  it('passes the empty reply through on the last attempt', () => withRelay(async request => {
    mocks.key.allowedProviders = ['antigravity']
    mocks.accounts[0]!.metadata = { project: 'google-project' }
    mocks.fetch.mockImplementation(async () => malformedResponse())
    const response = await request({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'Hello' }], stream: true }, '/api/antigravity/v1/messages')
    expect(response.status).toBe(200)
    expect(response.body).toContain('MALFORMED_FUNCTION_CALL')
    expect(mocks.fetch).toHaveBeenCalledTimes(3)
    expect(mocks.logs).toHaveLength(1)
    expect(mocks.logs[0]?.[22]).toBe('error')
  }))

  it('retries an empty native Gemini stream as well', () => withRelay(async request => {
    mocks.key.allowedProviders = ['antigravity']
    mocks.accounts[0]!.metadata = { project: 'project' }
    mocks.fetch.mockResolvedValueOnce(malformedResponse()).mockResolvedValueOnce(nativeResponse())
    const response = await request({ contents: [{ role: 'user', parts: [{ text: 'Hi' }] }] },
      '/api/antigravity/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse')
    expect(response.status).toBe(200)
    expect(response.body).toContain('Native answer')
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
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


describe('Chat-backed Responses usage and termination', () => {
  it.each([['kimi', 'kimi-k2.7-code'], ['qwen', 'qwen3.8-max'], ['xiaomi', 'mimo-v2.6-pro'], ['zhipu', 'glm-5.3']])(
    '%s requests usage and consumes the frame after finish_reason', (provider, model) => withRelay(async request => {
      mocks.fetch.mockImplementation(async (_url, init) => {
        const body = JSON.parse(init.body)
        expect(body.stream_options).toEqual({ include_usage: true, extra: 'preserved' })
        return sse([{ choices: [{ delta: { content: 'answer' }, finish_reason: 'stop' }] },
          { choices: [], usage: { prompt_tokens: 17, completion_tokens: 3 } }])
      })
      const response = await request({ model, input: 'Hi', stream_options: { include_usage: false, extra: 'preserved' } }, `/api/${provider}/v1/responses`)
      expect(response.body).toContain('response.completed')
      expect(mocks.logs).toHaveLength(1)
      expect(mocks.logs[0]?.slice(9, 11)).toEqual([17, 3])
    }))
  it.each([{ events: [] }, { events: [{ choices: [{ delta: { content: 'partial' } }] }] }])('marks an unfinished adapter stream as failed', ({ events }) => withRelay(async request => {
    mocks.fetch.mockResolvedValueOnce(sse(events))
    const response = await request({ model: 'qwen3.8-max', input: 'Hi' }, '/api/qwen/v1/responses')
    expect(response.body).toContain('response.failed')
    expect(response.body).not.toContain('response.completed')
    expect(mocks.logs).toHaveLength(1)
    expect(mocks.logs[0]?.[22]).toBe('error')
  }))
})


describe('upstream compatibility errors and usage provenance', () => {
  it.each([
    { model: 'glm-5.3', reasoning: { effort: 'ultra' }, input: 'Hi' },
    { model: 'glm-5.2', input: [{ role: 'user', content: [{ type: 'input_image', image_url: 'https://example.org/a.png' }] }] },
  ])('rejects invalid local conversion without penalizing accounts', body => withRelay(async request => {
    mocks.cost = 0
    const response = await request(body, '/api/zhipu/v1/responses')
    expect(response.status).toBe(400)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.penalizeAccount).not.toHaveBeenCalled()
    expect(mocks.logs).toHaveLength(1)
    expect(mocks.logs[0]?.[36]).toBe('missing')
  }))
  it('uses the mapped effort for both the upstream and billing metadata', () => withRelay(async request => {
    mocks.fetch.mockImplementation(async (_url, init) => {
      expect(JSON.parse(init.body).reasoning_effort).toBe('high')
      return sse([{ choices: [{ delta: { content: 'yes' }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0 } }])
    })
    await request({ model: 'glm-5.3', reasoning: { effort: 'high' }, input: 'Hi' }, '/api/zhipu/v1/responses')
    expect(mocks.logs[0]?.[33]).toBe('high')
    expect(mocks.logs[0]?.[36]).toBe('upstream')
  }))
  it('records a successful native response without usage as missing, not an estimated charge', () => withRelay(async request => {
    mocks.cost = 0
    mocks.fetch.mockResolvedValueOnce(sse([{ type: 'response.completed', response: { id: 'r', status: 'completed', output: [] } }]))
    await request(prompt)
    expect(mocks.logs[0]?.[22]).toBe('success')
    expect(mocks.logs[0]?.[36]).toBe('missing')
    expect(mocks.transactions).toHaveLength(0)
  }))
})
