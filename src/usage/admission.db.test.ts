import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => {
  const raw = process.env.TEST_DATABASE_URL
  if (!raw) return null
  const url = new URL(raw)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must identify a local *_test database')
  }
  const schema = `admission_qa_${Date.now()}_${Math.random().toString(16).slice(2)}`
  url.searchParams.set('options', `-c search_path=${schema}`)
  return { url: url.toString(), schema }
})
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../http/upstream', () => ({ fetchWithConnectTimeout: mocks.fetch }))
vi.mock('../config', async importOriginal => {
  const original = await importOriginal<typeof import('../config')>()
  return { ...original, config: { ...original.config, DATABASE_URL: database?.url ?? original.config.DATABASE_URL } }
})

import { pool } from '../db'
import { initDb } from '../db/init'
import { initPricing } from './pricing'
import { createAccount, getAccount } from '../accounts/manager'
import { createApiKey } from '../keys/manager'
import type { AuthedApiKey } from '../middleware/apiKeyAuth'
import { createMediaTask, refreshMediaTask } from '../media/tasks'
import { parseGrsaiGenerateRequest } from '../providers/grsai/client'
import { admitRelayRequest, acquireAdmittedAccount, releaseAdmittedAccount, withRequestAdmission, type RelayAdmission } from './admission'

const video = parseGrsaiGenerateRequest({ model: 'minimax-h3', prompt: 'Admission regression', aspectRatio: 'landscape', resolution: '768p', duration: 10 })

describe.runIf(database)('shared relay and media admission', () => {
  const leases: RelayAdmission[] = []
  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA ${database!.schema}`)
    await initDb()
    await initPricing()
  })
  afterAll(async () => {
    await Promise.all(leases.map(lease => lease.release()))
    await pool.query(`DROP SCHEMA IF EXISTS ${database!.schema} CASCADE`)
    await pool.end()
  })
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetch.mockImplementation(async () => Response.json({ id: 'supplier-task', status: 'running' }))
  })

  async function fixture(balance = 1_000_000, scope?: 'key' | 'user' | 'account') {
    const userId = randomUUID()
    await pool.query("INSERT INTO users (id,name,email,balance_micros) VALUES ($1,'Admission QA',$2,$3)", [userId, `${userId}@example.test`, balance])
    const secret = await createApiKey({ userId, name: 'Admission key', allowedProviders: ['grsai'] })
    const added = await createAccount({ provider: 'grsai', name: 'Admission supplier', concurrencyLimit: scope === 'account' ? 1 : null,
      tokens: { accessToken: 'sk-test-supplier-key', refreshToken: '', expiresAt: 0 } })
    const account = { ...(await getAccount(added.id))!, effectiveWeight: 1 }
    const key: AuthedApiKey = { id: secret.id, name: 'Admission key', userId, allowedProviders: ['grsai'], allowedModels: null,
      modelMappings: null, accountGroupId: null, groupMultiplier: 1, rateLimit: null, concurrencyLimit: scope === 'key' ? 1 : null,
      userConcurrencyLimit: scope === 'user' ? 1 : null, quotaLimit: null, quotaUsed: 0, userBalance: balance / 1e6, userBalanceMicros: balance,
      billTo: 'balance', subscriptionId: null }
    return { key, account }
  }
  async function relay(key: AuthedApiKey, estimateMicros = 98_000, enforceBalance = false) {
    const lease = await admitRelayRequest({ apiKeyId: key.id, userId: key.userId!, keyLimit: key.concurrencyLimit,
      userLimit: key.userConcurrencyLimit, estimateMicros, billTo: key.billTo, enforceBalance })
    leases.push(lease)
    return lease
  }

  it.each(['key', 'user', 'account'] as const)('counts a live relay against the media %s concurrency cap', async scope => {
    const { key, account } = await fixture(1_000_000, scope)
    const lease = await relay(key)
    expect(await withRequestAdmission(lease.id, () => acquireAdmittedAccount(account.id, account.concurrencyLimit))).toBe(true)
    await expect(createMediaTask(key, account, video, 'minimax-h3')).rejects.toMatchObject({ statusCode: 429 })
    expect(mocks.fetch).not.toHaveBeenCalled()
    await lease.release()
    await expect(createMediaTask(key, account, video, 'minimax-h3')).resolves.toMatchObject({ status: 'running' })
  })

  it.each(['key', 'user'] as const)('counts a durable media task against a relay %s cap', async scope => {
    const { key, account } = await fixture(1_000_000, scope)
    await createMediaTask(key, account, video, 'minimax-h3')
    await expect(relay(key)).rejects.toMatchObject({ statusCode: 429 })
  })

  it('counts durable supplier tasks across users and frees a relay account on retry', async () => {
    const first = await fixture(1_000_000, 'account')
    const second = await fixture()
    const lease = await relay(second.key)
    expect(await withRequestAdmission(lease.id, () => acquireAdmittedAccount(first.account.id, 1))).toBe(true)
    await expect(createMediaTask(first.key, first.account, video, 'minimax-h3')).rejects.toMatchObject({ statusCode: 429 })
    await withRequestAdmission(lease.id, releaseAdmittedAccount)
    await createMediaTask(first.key, first.account, video, 'minimax-h3')
    expect(await withRequestAdmission(lease.id, () => acquireAdmittedAccount(first.account.id, 1))).toBe(false)
    expect(await withRequestAdmission(lease.id, () => acquireAdmittedAccount(second.account.id, null))).toBe(true)
  })

  it.each(['relay-first', 'media-first'] as const)('shares wallet reservations with relay-only protection disabled: %s', async order => {
    const { key, account } = await fixture(150_000)
    if (order === 'relay-first') {
      await relay(key)
      await expect(createMediaTask(key, account, video, 'minimax-h3')).rejects.toMatchObject({ statusCode: 402 })
      expect(mocks.fetch).not.toHaveBeenCalled()
    } else {
      await createMediaTask(key, account, video, 'minimax-h3')
      await expect(relay(key)).rejects.toMatchObject({ statusCode: 402 })
    }
  })

  it.each(['relay-first', 'media-first'] as const)('shares pending API key quota: %s', async order => {
    const { key, account } = await fixture()
    await pool.query('UPDATE api_keys SET quota_limit = 0.15 WHERE id = $1', [key.id])
    if (order === 'relay-first') {
      await relay(key)
      await expect(createMediaTask(key, account, video, 'minimax-h3')).rejects.toMatchObject({ statusCode: 429 })
    } else {
      await createMediaTask(key, account, video, 'minimax-h3')
      await expect(relay(key)).rejects.toMatchObject({ statusCode: 429 })
    }
  })

  it('serializes simultaneous relay/media admission without exceeding a shared cap', async () => {
    const { key, account } = await fixture(1_000_000, 'user')
    const results = await Promise.allSettled([relay(key), createMediaTask(key, account, video, 'minimax-h3')])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { statusCode: 429 } })
  })

  it('releases completed media capacity and balance reservations after settlement', async () => {
    const { key, account } = await fixture(150_000, 'user')
    const task = await createMediaTask(key, account, video, 'minimax-h3')
    await expect(relay(key, 40_000)).rejects.toMatchObject({ statusCode: 429 })
    await pool.query('UPDATE media_tasks SET next_poll_at = 0 WHERE id = $1', [task.id])
    mocks.fetch.mockResolvedValueOnce(Response.json({ id: 'supplier-task', status: 'succeeded', results: [{ url: 'https://example.test/video.mp4' }] }))
    expect((await refreshMediaTask(task)).settled).toBe(true)
    await expect(relay(key, 40_000, true)).resolves.toBeDefined()
    expect((await pool.query('SELECT balance_micros FROM users WHERE id = $1', [key.userId])).rows[0].balance_micros).toBe(52_000)
  })

  it('expires crashed relay leases without releasing durable media reservations', async () => {
    const { key, account } = await fixture(150_000, 'user')
    const lease = await relay(key)
    await pool.query('UPDATE relay_reservations SET lease_expires_at = 0 WHERE id = $1', [lease.id])
    await expect(withRequestAdmission(lease.id, () => acquireAdmittedAccount(account.id, 1))).rejects.toThrow('expired')
    await createMediaTask(key, account, video, 'minimax-h3')
    await expect(relay(key)).rejects.toMatchObject({ statusCode: 429 })
  })
})
