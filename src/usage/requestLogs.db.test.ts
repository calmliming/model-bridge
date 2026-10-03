import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => {
  if (!process.env.TEST_DATABASE_URL) return null
  const url = new URL(process.env.TEST_DATABASE_URL)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must identify a local *_test database')
  }
  const schema = `logs_qa_${Date.now()}_${Math.random().toString(16).slice(2)}`
  url.searchParams.set('options', `-c search_path=${schema}`)
  return { url: url.toString(), schema }
})
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../http/upstream', () => ({ fetchWithConnectTimeout: mocks.fetch }))
vi.mock('../config', async original => {
  const value = await original<typeof import('../config')>()
  return { ...value, config: { ...value.config, DATABASE_URL: database?.url ?? value.config.DATABASE_URL } }
})

import { pool } from '../db'
import { initDb } from '../db/init'
import { initPricing } from './pricing'
import { createApiKey } from '../keys/manager'
import { createAccount } from '../accounts/manager'
import { pickAccount } from '../accounts/scheduler'
import { createMediaTask, refreshMediaTask } from '../media/tasks'
import { parseGrsaiGenerateRequest } from '../providers/grsai/client'
import { listRequestLogs } from './requestLogs'
import { recordUsage } from './recorder'
import { withLiveImageRequest } from './liveRequests'
import { emptyUsage } from '../providers/types'
import { registerRelayRoutes } from '../routes/relay'
import { registerRequestLogRoutes } from '../routes/requestLogs'
import type { AuthedApiKey } from '../middleware/apiKeyAuth'

describe.runIf(database)('unified request logs in PostgreSQL', () => {
  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA ${database!.schema}`)
    await initDb()
    await initPricing()
  })
  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${database!.schema} CASCADE`)
    await pool.end()
  })
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetch.mockResolvedValue(Response.json({ id: 'task-1', status: 'running', progress: 25 }))
  })

  async function fixture() {
    const userId = randomUUID()
    await pool.query("INSERT INTO users (id,name,email,balance_micros) VALUES ($1,'Logs QA',$2,1000000)", [userId, `${userId}@example.test`])
    const secret = await createApiKey({ userId, name: 'Logs QA key', allowedProviders: ['grsai'] })
    const added = await createAccount({ provider: 'grsai', name: 'Test channel', tokens: { accessToken: 'sk-test-only', refreshToken: '', expiresAt: 0 } })
    const selected = (await pickAccount('grsai', [], null, null, 'gpt-image-2'))!
    const account = { ...selected, id: added.id, oauthAccessToken: (await pool.query('SELECT oauth_access_token FROM accounts WHERE id=$1', [added.id])).rows[0].oauth_access_token }
    const key: AuthedApiKey = { id: secret.id, name: 'Logs QA key', userId, allowedProviders: ['grsai'], allowedModels: null,
      modelMappings: null, accountGroupId: null, groupMultiplier: 1, rateLimit: null, concurrencyLimit: null,
      userConcurrencyLimit: null, quotaLimit: null, quotaUsed: 0, userBalance: 1, userBalanceMicros: 1_000_000,
      billTo: 'balance', subscriptionId: null }
    return { userId, key, secret: secret.key, account }
  }

  it('shows submitting and running third-party GPT images under OpenAI, then one settled row', async () => {
    const { key, account, userId } = await fixture()
    let release!: (response: Response) => void
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    mocks.fetch.mockImplementationOnce(() => { entered(); return new Promise<Response>(resolve => { release = resolve }) })
    const pending = createMediaTask(key, account, parseGrsaiGenerateRequest({ model: 'gpt-image-2.5-flare', prompt: 'Draw a tree' }), 'drawing-alias')
    await started
    const submitting = await listRequestLogs(1, 20, { manufacturer: 'openai', kind: 'image' }, userId)
    expect(submitting.total).toBe(1)
    expect(submitting.logs[0]).toMatchObject({ status: 'running', taskStatus: 'submitting', cost: null, model: 'gpt-image-2.5-flare', requestedModel: 'drawing-alias' })
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM usage_logs WHERE user_id=$1', [userId])).rows[0].count).toBe(0)
    release(Response.json({ id: 'task-1', status: 'running', progress: 25 }))
    const task = await pending
    expect((await listRequestLogs(1, 20, { status: 'running' }, userId)).logs[0].progress).toBe(25)

    await pool.query("UPDATE media_tasks SET status='succeeded', progress=100, results=$2, next_poll_at=0 WHERE id=$1", [task.id, JSON.stringify([{ url: 'https://example.test/image.png' }])])
    const settling = await listRequestLogs(1, 20, {}, userId)
    expect(settling.logs[0]).toMatchObject({ status: 'settling', cost: null, results: [] })
    await refreshMediaTask(task)
    const completed = await listRequestLogs(1, 20, { manufacturer: 'openai' }, userId)
    expect(completed.total).toBe(1)
    expect(completed.logs[0]).toMatchObject({ status: 'success', cost: 0.014, imageCount: 1, results: [{ url: 'https://example.test/image.png' }] })
    expect((await listRequestLogs(1, 20, { status: 'running' }, userId)).total).toBe(0)
    expect((await listRequestLogs(1, 1, { id: task.id }, userId)).logs[0].status).toBe('success')
    expect((await pool.query('SELECT balance_micros FROM users WHERE id=$1', [userId])).rows[0].balance_micros).toBe(986_000)
  })

  it('shows MiniMax video progress and records failed generation without billing', async () => {
    const { key, account, userId } = await fixture()
    const body = parseGrsaiGenerateRequest({ model: 'minimax-h3', prompt: 'A bird', duration: 5, resolution: '480p', aspectRatio: 'landscape' })
    const task = await createMediaTask(key, account, body, 'minimax-h3')
    const running = await listRequestLogs(1, 20, { manufacturer: 'minimax', kind: 'video', status: 'running' }, userId)
    expect(running.logs[0]).toMatchObject({ progress: 25, cost: null, videoSeconds: 5, videoResolution: '480p' })
    expect((await listRequestLogs(1, 20, { manufacturer: 'openai' }, userId)).total).toBe(0)
    await pool.query('UPDATE media_tasks SET next_poll_at=0 WHERE id=$1', [task.id])
    mocks.fetch.mockResolvedValueOnce(Response.json({ id: 'task-1', status: 'violation', error: 'input moderation' }, { status: 400 }))
    await refreshMediaTask(task)
    const failed = await listRequestLogs(1, 20, { status: 'error' }, userId)
    expect(failed.total).toBe(1)
    expect(failed.logs[0]).toMatchObject({ manufacturer: 'minimax', cost: 0, errorCode: 'violation', errorMessage: 'input moderation' })
    expect((await pool.query('SELECT balance_micros FROM users WHERE id=$1', [userId])).rows[0].balance_micros).toBe(1_000_000)
  })

  it('persists synchronous image generation before the upstream finishes and deduplicates its usage', async () => {
    const { userId, secret } = await fixture()
    const app = Fastify()
    await app.register(jwt, { secret: 'live-logs-test' })
    registerRelayRoutes(app)
    registerRequestLogRoutes(app)
    let entered!: () => void
    let release!: (value: Response) => void
    const started = new Promise<void>(resolve => { entered = resolve })
    mocks.fetch.mockImplementationOnce(() => { entered(); return new Promise<Response>(resolve => { release = resolve }) })
    const response = app.inject({ method: 'POST', url: '/api/media/v1/images/generations',
      headers: { authorization: `Bearer ${secret}` }, payload: { model: 'gpt-image-2', prompt: 'A lake', response_format: 'url' } })
    // LightMyRequest is a lazy thenable; start it before waiting for upstream.
    const pending = response.then(value => value)
    try {
      await started
      const active = await listRequestLogs(1, 20, { manufacturer: 'openai', status: 'running' }, userId)
      expect(active.total).toBe(1)
      expect(active.logs[0]).toMatchObject({ status: 'running', kind: 'image', cost: null, progress: null })
      expect(active.logs[0]).not.toHaveProperty('provider')
      release(Response.json({ id: 'sync-image', status: 'succeeded', results: [{ url: 'https://example.test/result.png' }] }))
      expect((await pending).statusCode).toBe(200)
      const finished = await listRequestLogs(1, 20, {}, userId)
      expect(finished.total).toBe(1)
      expect(finished.logs[0]).toMatchObject({ status: 'success', manufacturer: 'openai', imageCount: 1, cost: 0.0042 })
      const live = (await pool.query('SELECT * FROM live_requests WHERE user_id=$1', [userId])).rows[0]
      expect(live.usage_log_id).toBeTruthy()
      expect(live.finished_at).toBeGreaterThanOrEqual(live.created_at)
    } finally { release?.(Response.json({ id: 'sync-image', status: 'failed', error: 'test finished' })); await pending; await app.close() }
  })

  it('filters before pagination and uses declared model ownership across aggregate channels and aliases', async () => {
    const { key, userId } = await fixture()
    const entries = [
      ['custom-alias', 'openai/gpt-image-2.5', 'sub2api'],
      ['gpt-image-2-vip', null, 'grsai'],
      ['minimax-h3', null, 'grsai'],
      ['claude-sonnet-5', null, 'antigravity'],
      ['models/gemini-3.8-flash', null, 'antigravity'],
      ['unrecognized', null, 'sub2api'],
    ]
    for (const [model, upstream, provider] of entries) {
      await pool.query(`INSERT INTO usage_logs (id,api_key_id,user_id,provider,model,upstream_model,ts) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [randomUUID(), key.id, userId, provider, model, upstream, Date.now()])
    }
    const openai = await listRequestLogs(2, 1, { manufacturer: 'openai' }, userId)
    expect(openai.total).toBe(2)
    expect(openai.logs).toHaveLength(1)
    expect(openai.logs[0].manufacturer).toBe('openai')
    for (const manufacturer of ['minimax', 'anthropic', 'google', 'unknown']) {
      expect((await listRequestLogs(1, 20, { manufacturer }, userId)).total).toBe(1)
    }
    expect((await listRequestLogs(1, 20, { key: key.id, model: 'vip' })).total).toBe(1)
  })

  it('enforces ownership for active and completed requests and withholds internal channel data', async () => {
    const first = await fixture()
    const second = await fixture()
    await createMediaTask(first.key, first.account, parseGrsaiGenerateRequest({ model: 'gpt-image-2', prompt: 'First owner only' }), 'gpt-image-2')
    await createMediaTask(second.key, second.account, parseGrsaiGenerateRequest({ model: 'minimax-h3', prompt: 'Second owner only', duration: 5, resolution: '480p', aspectRatio: 'landscape' }), 'minimax-h3')
    const own = await listRequestLogs(1, 20, {}, first.userId)
    expect(own.total).toBe(1)
    expect(own.logs[0].requestInput).toBe('First owner only')
    expect(own.logs[0]).not.toHaveProperty('accountName')
    expect(own.logs[0]).not.toHaveProperty('upstreamRequestId')
    expect(own.logs[0]).not.toHaveProperty('provider')
    expect((await listRequestLogs(1, 20, { key: second.key.id }, first.userId)).total).toBe(0)
    expect((await listRequestLogs(1, 1, { id: own.logs[0].id }, second.userId)).total).toBe(0)
    expect((await listRequestLogs(1, 20, { key: first.key.id })).logs[0]).toMatchObject({ provider: 'grsai', accountName: 'Test channel' })
  })

  it('marks an expired synchronous request as interrupted instead of leaving it generating forever', async () => {
    const { key, userId } = await fixture()
    await pool.query(`INSERT INTO live_requests (id,api_key_id,user_id,provider,model,requested_model,created_at,lease_expires_at)
      VALUES ($1,$2,$3,'grsai','gpt-image-2','gpt-image-2',$4,$5)`, [randomUUID(), key.id, userId, Date.now() - 120_000, Date.now() - 1])
    await initDb()
    expect((await listRequestLogs(1, 20, { status: 'running' }, userId)).total).toBe(0)
    expect((await listRequestLogs(1, 20, { status: 'error' }, userId)).logs[0]).toMatchObject({ manufacturer: 'openai', errorCode: 'request_interrupted', cost: null })
  })

  it('keeps concurrent synchronous requests attached to their own usage and wallet', async () => {
    const fixtures = await Promise.all([fixture(), fixture()])
    await Promise.all(fixtures.map(({ key, userId }) => withLiveImageRequest({ apiKeyId: key.id, userId, provider: 'grsai',
      model: 'gpt-image-2', requestedModel: 'gpt-image-2', requestInput: userId }, async () => {
      expect(await recordUsage({ apiKeyId: key.id, userId, accountId: null, provider: 'grsai', model: 'gpt-image-2',
        usage: { ...emptyUsage(), imageCount: 1 }, status: 'success', latencyMs: 1, requestInput: userId })).toBe(true)
    }, () => 200)))
    for (const { userId } of fixtures) {
      const logs = await listRequestLogs(1, 20, {}, userId)
      expect(logs.total).toBe(1)
      expect(logs.logs[0]).toMatchObject({ requestInput: userId, status: 'success', cost: 0.0042 })
      expect((await pool.query('SELECT balance_micros FROM users WHERE id=$1', [userId])).rows[0].balance_micros).toBe(995_800)
    }
  })
})
