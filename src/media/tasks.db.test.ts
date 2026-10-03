import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => {
  const raw = process.env.TEST_DATABASE_URL
  if (!raw) return null
  const url = new URL(raw)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must identify a local *_test database')
  }
  const schema = `media_qa_${Date.now()}_${Math.random().toString(16).slice(2)}`
  url.searchParams.set('options', `-c search_path=${schema}`)
  return { url: url.toString(), schema }
})
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../http/upstream', () => ({ fetchWithConnectTimeout: mocks.fetch }))
vi.mock('../config', async importOriginal => {
  const original = await importOriginal<typeof import('../config')>()
  return { ...original, config: { ...original.config, DATABASE_URL: database?.url ?? original.config.DATABASE_URL } }
})

import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import { pool } from '../db'
import { initDb } from '../db/init'
import { initPricing, reloadPricing } from '../usage/pricing'
import { recordUsage } from '../usage/recorder'
import { createAccount } from '../accounts/manager'
import { createApiKey } from '../keys/manager'
import { pickAccount } from '../accounts/scheduler'
import { parseGrsaiGenerateRequest } from '../providers/grsai/client'
import { createMediaTask, getMediaTask, refreshMediaTask, mediaTaskUsage } from './tasks'
import { registerMediaRoutes } from '../routes/media'
import { registerUserRoutes } from '../routes/users'
import { registerRelayRoutes } from '../routes/relay'
import { registerAuthRoutes } from '../routes/auth'
import type { AuthedApiKey } from '../middleware/apiKeyAuth'

const video = parseGrsaiGenerateRequest({ model: 'minimax-h3', prompt: 'A cat walking in a garden', aspectRatio: 'landscape', resolution: '768p', duration: 10 })

describe.runIf(database)('GrsAI persistent media tasks', () => {
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
    mocks.fetch.mockImplementation(async () => Response.json({ id: 'supplier-task-1', status: 'running' }))
  })
  async function fixture(balance = 1_000_000, accountLimit: number | null = null) {
    const userId = randomUUID()
    await pool.query("INSERT INTO users (id,name,email,balance_micros) VALUES ($1,'Media QA',$2,$3)", [userId, `${userId}@example.test`, balance])
    const secret = await createApiKey({ userId, name: 'Media key', allowedProviders: ['grsai'] })
    const added = await createAccount({ provider: 'grsai', name: 'Media supplier', concurrencyLimit: accountLimit,
      tokens: { accessToken: 'sk-test-supplier-key', refreshToken: '', expiresAt: 0 } })
    const selected = await pickAccount('grsai', [], null, null, 'minimax-h3')
    const account = { ...selected!, id: added.id, concurrencyLimit: accountLimit,
      oauthAccessToken: (await pool.query('SELECT oauth_access_token FROM accounts WHERE id=$1', [added.id])).rows[0].oauth_access_token }
    const key: AuthedApiKey = { id: secret.id, name: 'Media key', userId, allowedProviders: ['grsai'], allowedModels: null,
      modelMappings: null, accountGroupId: null, groupMultiplier: 1, rateLimit: null, concurrencyLimit: null,
      userConcurrencyLimit: null, quotaLimit: null, quotaUsed: 0, userBalance: balance / 1e6, userBalanceMicros: balance,
      billTo: 'balance', subscriptionId: null }
    return { key, secret: secret.key, account }
  }
  async function due(id: string) { await pool.query('UPDATE media_tasks SET next_poll_at = 0 WHERE id = $1', [id]) }

  it('recovers a saved task and charges exactly once under concurrent polling/settlement', async () => {
    const { key, account } = await fixture()
    const task = await createMediaTask(key, account, video, 'minimax-h3')
    expect(task.status).toBe('running')
    expect((await getMediaTask(task.id))?.upstream_id).toBe('supplier-task-1')
    await initDb() // Boot-time initialization must preserve pending tasks.
    await due(task.id)
    mocks.fetch.mockImplementation(async () => Response.json({ id: 'supplier-task-1', status: 'succeeded', results: [{ url: 'https://files.example.com/video.mp4' }] }))
    await Promise.all(Array.from({ length: 4 }, () => refreshMediaTask(task)))
    const complete = (await getMediaTask(task.id))!
    expect(complete.settled).toBe(true)
    const record = { apiKeyId: key.id, userId: key.userId, accountId: account.id, provider: 'grsai', model: 'minimax-h3',
      usage: mediaTaskUsage(complete), status: 'success', latencyMs: 1, idempotencyKey: `grsai-task:${task.id}` }
    expect(await Promise.all([recordUsage(record), recordUsage(record)])).toEqual([true, true])
    expect((await pool.query('SELECT cost, video_seconds, video_resolution FROM usage_logs WHERE api_key_id=$1', [key.id])).rows).toEqual([
      { cost: 0.098, video_seconds: 10, video_resolution: '768p' },
    ])
    expect((await pool.query('SELECT balance_micros FROM users WHERE id=$1', [key.userId])).rows[0].balance_micros).toBe(902_000)
    expect((await pool.query('SELECT quota_used FROM api_keys WHERE id=$1', [key.id])).rows[0].quota_used).toBeCloseTo(0.098)
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM wallet_transactions WHERE user_id=$1', [key.userId])).rows[0].count).toBe(1)
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })
  it('enforces persistent concurrency across simultaneous task submissions', async () => {
    const { key, account } = await fixture()
    key.concurrencyLimit = 1
    const results = await Promise.allSettled([createMediaTask(key, account, video, 'minimax-h3'), createMediaTask(key, account, video, 'minimax-h3')])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason.statusCode).toBe(429)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('reserves pending cost durably and rejects insufficient balance before generation', async () => {
    const { key, account } = await fixture(150_000)
    await createMediaTask(key, account, video, 'minimax-h3')
    await expect(createMediaTask(key, account, video, 'minimax-h3')).rejects.toMatchObject({ statusCode: 402 })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('reserves key cost quota for pending tasks before their eventual settlement', async () => {
    const { key, account } = await fixture()
    await pool.query('UPDATE api_keys SET quota_limit = 0.15 WHERE id = $1', [key.id])
    await createMediaTask(key, account, video, 'minimax-h3')
    await expect(createMediaTask(key, account, video, 'minimax-h3')).rejects.toMatchObject({ statusCode: 429 })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('shares the persistent supplier concurrency cap across different users', async () => {
    const first = await fixture(1_000_000, 1)
    const second = await fixture()
    await createMediaTask(first.key, first.account, video, 'minimax-h3')
    await expect(createMediaTask(second.key, first.account, video, 'minimax-h3')).rejects.toMatchObject({ statusCode: 429 })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('releases interrupted submissions without recreating an unknown upstream task', async () => {
    const { key, account } = await fixture()
    const task = await createMediaTask(key, account, video, 'minimax-h3')
    await pool.query("UPDATE media_tasks SET status='submitting', upstream_id=NULL, created_at=$2, next_poll_at=0 WHERE id=$1", [task.id, Date.now() - 121_000])
    const failed = await refreshMediaTask(task)
    expect(failed.status).toBe('failed')
    expect(failed.settled).toBe(true)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect((await pool.query('SELECT cost FROM usage_logs WHERE api_key_id=$1', [key.id])).rows[0].cost).toBe(0)
  })
  it('does not charge or retain reserved capacity for policy-violating tasks', async () => {
    const { key, account } = await fixture()
    const task = await createMediaTask(key, account, video, 'minimax-h3')
    await due(task.id)
    mocks.fetch.mockResolvedValueOnce(Response.json({ id: 'supplier-task-1', status: 'violation', error: 'input moderation' }, { status: 400 }))
    const failed = await refreshMediaTask(task)
    expect(failed.status).toBe('violation')
    expect(failed.settled).toBe(true)
    expect((await pool.query('SELECT cost FROM usage_logs WHERE api_key_id=$1', [key.id])).rows[0].cost).toBe(0)
    expect((await pool.query('SELECT balance_micros FROM users WHERE id=$1', [key.userId])).rows[0].balance_micros).toBe(1_000_000)
  })
  it('records failed submission without retrying or charging the wallet', async () => {
    const { key, account } = await fixture()
    mocks.fetch.mockRejectedValue(new Error('timeout Bearer sk-abcdefghijkl https://private.example.com'))
    const task = await createMediaTask(key, account, video, 'minimax-h3')
    expect(task.status).toBe('failed')
    expect(task.settled).toBe(true)
    expect(task.error).not.toContain('sk-abcdefghijkl')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect((await pool.query('SELECT balance_micros FROM users WHERE id=$1', [key.userId])).rows[0].balance_micros).toBe(1_000_000)
    expect((await pool.query('SELECT cost FROM usage_logs WHERE api_key_id=$1', [key.id])).rows[0].cost).toBe(0)
  })
  it('settles at the admission price after an administrator changes the rate', async () => {
    const { key, account } = await fixture()
    const task = await createMediaTask(key, account, video, 'minimax-h3')
    await pool.query("UPDATE model_pricing SET video_second_768_price = 0.02 WHERE provider='grsai' AND model='minimax-h3'")
    await reloadPricing()
    await due(task.id)
    mocks.fetch.mockResolvedValueOnce(Response.json({ id: 'supplier-task-1', status: 'succeeded', results: [{ url: 'https://files.example.com/video.mp4' }] }))
    await refreshMediaTask(task)
    expect((await pool.query('SELECT cost FROM usage_logs WHERE api_key_id=$1', [key.id])).rows[0].cost).toBe(0.098)
    await pool.query("UPDATE model_pricing SET video_second_768_price = 0.0098 WHERE provider='grsai' AND model='minimax-h3'")
    await reloadPricing()
  })
  it('keeps results accessible after budget exhaustion and hides other owners tasks', async () => {
    const { key, secret, account } = await fixture()
    mocks.fetch.mockResolvedValueOnce(Response.json({ id: 'supplier-task-1', status: 'succeeded', results: [{ url: 'https://files.example.com/video.mp4' }] }))
    const task = await createMediaTask(key, account, video, 'minimax-h3')
    await pool.query('UPDATE users SET balance_micros = 0 WHERE id=$1', [key.userId])
    await pool.query('UPDATE api_keys SET quota_limit=quota_used WHERE id=$1', [key.id])
    const app = Fastify()
    registerMediaRoutes(app)
    const result = await app.inject({ url: `/api/grsai/v1/videos/${task.id}`, headers: { authorization: `Bearer ${secret}` } })
    expect(result.statusCode).toBe(200)
    expect(result.json().results[0].url).toContain('video.mp4')
    expect(result.json().account_id).toBeUndefined()
    const other = await fixture()
    const forbidden = await app.inject({ url: `/v1/videos/${task.id}`, headers: { authorization: `Bearer ${other.secret}` } })
    expect(forbidden.statusCode).toBe(404)
    const blocked = await app.inject({ method: 'POST', url: '/v1/videos', headers: { authorization: `Bearer ${secret}` }, payload: video })
    expect(blocked.statusCode).toBe(429)
    await app.close()
  })
  it('rejects invalid H3 dimensions and disallowed models before submission', async () => {
    const { key, secret } = await fixture()
    const app = Fastify()
    registerMediaRoutes(app)
    const invalid = await app.inject({ method: 'POST', url: '/v1/videos', headers: { authorization: `Bearer ${secret}` }, payload: { ...video, resolution: '1080p', duration: 15 } })
    expect(invalid.statusCode).toBe(400)
    await pool.query('UPDATE api_keys SET allowed_models=$2 WHERE id=$1', [key.id, JSON.stringify(['gpt-image-2'])])
    const denied = await app.inject({ method: 'POST', url: '/v1/videos', headers: { authorization: `Bearer ${secret}` }, payload: video })
    expect(denied.statusCode).toBe(403)
    expect(mocks.fetch).not.toHaveBeenCalled()
    await app.close()
  })
  it('keeps public catalog, key scopes, task results and usage under our identity', async () => {
    const { key, secret, account } = await fixture()
    mocks.fetch.mockResolvedValueOnce(Response.json({ id: 'supplier-task-1', status: 'succeeded', results: [{ url: 'https://files.example.com/video.mp4' }] }))
    const task = await createMediaTask(key, account, video, 'minimax-h3')
    const app = Fastify()
    await app.register(fastifyJwt, { secret: 'test-public-media-secret' })
    registerUserRoutes(app)
    registerRelayRoutes(app)
    registerMediaRoutes(app)
    registerAuthRoutes(app)
    const userHeaders = { authorization: `Bearer ${app.jwt.sign({ sub: key.userId, role: 'user' })}` }
    const keys = await app.inject({ url: '/api/users/keys', headers: userHeaders })
    expect(keys.statusCode).toBe(200)
    expect(keys.json().keys[0].allowedProviders).toEqual(['media'])
    const usage = await app.inject({ url: '/api/users/usage', headers: userHeaders })
    expect(usage.json().logs[0]).toMatchObject({ provider: 'modelbridge', videoSeconds: 10, videoResolution: '768p' })
    const apiHeaders = { authorization: `Bearer ${secret}` }
    const models = await app.inject({ url: '/api/media/v1/models', headers: apiHeaders })
    expect(models.json().data.every((model: { owned_by: string }) => model.owned_by === 'modelbridge')).toBe(true)
    const result = await app.inject({ url: `/api/media/v1/videos/${task.id}`, headers: apiHeaders })
    expect(result.json().status).toBe('succeeded')
    const prices = await app.inject({ url: '/api/auth/model-prices' })
    expect(prices.json().prices.find((price: { model: string }) => price.model === 'minimax-h3').provider).toBe('modelbridge')
    const summary = await app.inject({ url: '/api/auth/system-summary' })
    for (const response of [keys, usage, models, result, prices, summary]) expect(response.body).not.toMatch(/grsai/i)
    await app.close()
  })
})
