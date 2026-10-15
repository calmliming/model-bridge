import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => {
  const raw = process.env.TEST_DATABASE_URL
  if (!raw) return null
  const url = new URL(raw)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must identify a local *_test database')
  }
  const schema = `key_limits_${Date.now()}_${Math.random().toString(16).slice(2)}`
  url.searchParams.set('options', `-c search_path=${schema}`)
  return { url: url.toString(), schema }
})
vi.mock('../config', async original => {
  const actual = await original<typeof import('../config')>()
  return { ...actual, config: { ...actual.config, DATABASE_URL: database?.url ?? actual.config.DATABASE_URL } }
})

import { pool } from '../db/index'
import { initDb } from '../db/init'
import { ApiKeyLimitError, createApiKey, updateApiKey, type UpdateApiKeyPatch } from './manager'

const limits = { maxActive: 1, maxPerHour: 60 }

describe.runIf(database)('API key limits under concurrent PostgreSQL transactions', () => {
  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA ${database!.schema}`)
    await initDb()
  })
  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${database!.schema} CASCADE`)
    await pool.end()
  })

  async function user() {
    const id = randomUUID()
    await pool.query("INSERT INTO users (id, email, name) VALUES ($1, $2, 'Key limit QA')", [id, `${id}@example.test`])
    return id
  }
  async function activeCount(userId: string) {
    return Number((await pool.query('SELECT COUNT(*) AS count FROM api_keys WHERE user_id=$1 AND enabled AND (expires_at IS NULL OR expires_at > $2)', [userId, Date.now()])).rows[0].count)
  }
  async function inactiveKey(userId: string, expired = false) {
    const key = await createApiKey({ userId, name: 'Inactive', ...(expired ? { expiresAt: Date.now() - 1000 } : {}) })
    if (!expired) await updateApiKey(key.id, { enabled: false }, userId, limits)
    return key
  }

  it('allows only one of several simultaneous creations at the active cap', async () => {
    const userId = await user()
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => createApiKey({ userId, name: 'Concurrent' }, limits)))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    for (const result of results) if (result.status === 'rejected') expect(result.reason).toBeInstanceOf(ApiKeyLimitError)
    expect(await activeCount(userId)).toBe(1)
  })

  it('checks hourly creation counts inside the same transaction', async () => {
    const userId = await user()
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => createApiKey({ userId, name: 'Hourly' }, { maxActive: 0, maxPerHour: 1 })))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(await activeCount(userId)).toBe(1)
  })

  it.each([
    [false, { enabled: true }],
    [true, { expiresAt: null }],
    [true, { expiresAt: Date.now() + 600_000 }],
  ] as Array<[boolean, UpdateApiKeyPatch]>)('cannot restore an inactive key above the cap (expired=%s, patch=%j)', async (expired, patch) => {
    const userId = await user()
    const inactive = await inactiveKey(userId, expired)
    await createApiKey({ userId, name: 'Replacement' }, limits)
    await expect(updateApiKey(inactive.id, patch, userId, limits)).rejects.toBeInstanceOf(ApiKeyLimitError)
    expect(await activeCount(userId)).toBe(1)
  })

  it('serializes creation and reactivation on the same owner lock', async () => {
    const userId = await user()
    const inactive = await inactiveKey(userId)
    const results = await Promise.allSettled([
      createApiKey({ userId, name: 'New' }, limits),
      updateApiKey(inactive.id, { enabled: true }, userId, limits),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(await activeCount(userId)).toBe(1)
  })

  it('serializes multiple simultaneous reactivations without charging the creation budget', async () => {
    const userId = await user()
    const first = await inactiveKey(userId)
    const second = await inactiveKey(userId)
    const results = await Promise.allSettled([first, second].map(key => updateApiKey(key.id, { enabled: true }, userId, { maxActive: 1, maxPerHour: 1 })))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(await activeCount(userId)).toBe(1)
  })

  it('permits existing active keys to be edited at the cap and restores keys when capacity is available', async () => {
    const userId = await user()
    const first = await createApiKey({ userId, name: 'Existing' }, limits)
    await updateApiKey(first.id, { name: 'Renamed', enabled: true, expiresAt: null }, userId, limits)
    await updateApiKey(first.id, { enabled: false }, userId, limits)
    await updateApiKey(first.id, { enabled: true }, userId, limits)
    expect(await activeCount(userId)).toBe(1)
    expect((await pool.query('SELECT name FROM api_keys WHERE id=$1', [first.id])).rows[0].name).toBe('Renamed')
  })

  it('keeps owner isolation when restoring keys', async () => {
    const owner = await user()
    const other = await user()
    const key = await inactiveKey(owner)
    await updateApiKey(key.id, { enabled: true }, other, limits)
    expect(await activeCount(owner)).toBe(0)
  })
})
