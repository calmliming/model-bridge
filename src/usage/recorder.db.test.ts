import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => {
  if (!process.env.TEST_DATABASE_URL) return null
  const url = new URL(process.env.TEST_DATABASE_URL)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must identify a local *_test database')
  }
  const schema = `usage_retry_qa_${Date.now()}_${Math.random().toString(16).slice(2)}`
  url.searchParams.set('options', `-c search_path=${schema}`)
  return { url: url.toString(), schema }
})
const failure = vi.hoisted(() => ({ connect: false, commitReply: false }))
vi.mock('../config', async original => {
  const value = await original<typeof import('../config')>()
  return { ...value, config: { ...value.config, DATABASE_URL: database?.url ?? value.config.DATABASE_URL,
    USAGE_OUTBOX_DIR: join(value.config.USAGE_OUTBOX_DIR, database?.schema ?? 'skipped') } }
})
vi.mock('../db/index', async original => {
  const value = await original<typeof import('../db/index')>()
  return { ...value, pool: {
    query: value.pool.query.bind(value.pool),
    end: value.pool.end.bind(value.pool),
    connect: async () => {
      if (failure.connect) throw new Error('simulated database disconnect')
      const client = await value.pool.connect()
      return { release: () => client.release(), query: async (sql: string, values?: unknown[]) => {
        const result = await client.query(sql, values)
        if (sql === 'COMMIT' && failure.commitReply) { failure.commitReply = false; throw new Error('lost commit reply') }
        return result
      } }
    },
  } }
})

import { pool } from '../db'
import { config } from '../config'
import { initDb } from '../db/init'
import { createApiKey } from '../keys/manager'
import { recordStreamUsage, replayPendingUsage } from './recorder'
import { DurableQueue, usageOutboxNamespace } from './durableQueue'

describe.runIf(database)('durable usage settlement in PostgreSQL', () => {
  const queue = new DurableQueue<any>(join(config.USAGE_OUTBOX_DIR, usageOutboxNamespace(config.DATABASE_URL)))
  beforeAll(async () => { await pool.query(`CREATE SCHEMA ${database!.schema}`); await initDb() })
  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${database!.schema} CASCADE`)
    await pool.end()
    await rm(config.USAGE_OUTBOX_DIR, { recursive: true, force: true })
  })
  beforeEach(() => { failure.connect = false; failure.commitReply = false })

  async function fixture() {
    const userId = randomUUID()
    await pool.query("INSERT INTO users (id, name, email, balance_micros) VALUES ($1,'Usage QA',$2,5000000)", [userId, `${userId}@example.test`])
    const key = await createApiKey({ userId, name: 'Usage QA', allowedProviders: ['openai'] })
    const record = { idempotencyKey: `stream:${randomUUID()}`, apiKeyId: key.id, userId, accountId: null,
      provider: 'openai', model: 'gpt-6.1-sol', status: 'success', latencyMs: 10, multiplier: 1.5,
      priceSnapshot: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
      usage: { inputTokens: 1_000_000, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 } }
    const state = async () => (await pool.query(`SELECT u.balance_micros, k.quota_used,
      (SELECT COUNT(*) FROM usage_logs WHERE api_key_id = k.id) AS logs,
      (SELECT COUNT(*) FROM wallet_transactions WHERE user_id = u.id) AS debits
      FROM users u JOIN api_keys k ON k.user_id = u.id WHERE k.id = $1`, [key.id])).rows[0]
    return { record, state }
  }

  it('recovers a database outage from the encrypted spool with the original amount and timestamp', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { record, state } = await fixture()
      failure.connect = true
      expect(await recordStreamUsage(record)).toBe(false)
      expect(await state()).toMatchObject({ balance_micros: 5_000_000, quota_used: 0, logs: 0, debits: 0 })
      const stored = (await queue.pending())[0]!
      record.priceSnapshot.input = 999
      failure.connect = false
      await replayPendingUsage()
      expect(await state()).toMatchObject({ balance_micros: 3_500_000, quota_used: 1.5, logs: 1, debits: 1 })
      const usage = (await pool.query('SELECT ts, billing_price FROM usage_logs WHERE api_key_id = $1', [record.apiKeyId])).rows[0]
      expect(usage.ts).toBe(stored.payload.settlement.recordedAt)
      expect(usage.billing_price.price.input).toBe(1)
      expect(await queue.pending()).toEqual([])
    } finally { log.mockRestore() }
  })

  it('does not duplicate wallet or quota debits after PostgreSQL commits but the reply is lost', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { record, state } = await fixture()
      failure.commitReply = true
      expect(await recordStreamUsage(record)).toBe(false)
      expect((await queue.pending()).length).toBe(1)
      expect(await state()).toMatchObject({ balance_micros: 3_500_000, quota_used: 1.5, logs: 1, debits: 1 })
      await replayPendingUsage()
      expect(await state()).toMatchObject({ balance_micros: 3_500_000, quota_used: 1.5, logs: 1, debits: 1 })
      expect(await queue.pending()).toEqual([])
    } finally { log.mockRestore() }
  })

  it('serializes concurrent retries of the same usage identity with a real advisory lock', async () => {
    const { record, state } = await fixture()
    expect(await Promise.all([recordStreamUsage(record), recordStreamUsage(record)])).toEqual([true, true])
    expect(await state()).toMatchObject({ balance_micros: 3_500_000, quota_used: 1.5, logs: 1, debits: 1 })
    expect(await queue.pending()).toEqual([])
  })
})
