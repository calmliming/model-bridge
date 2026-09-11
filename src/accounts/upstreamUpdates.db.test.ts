import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Opt-in against a local disposable database. Every run owns a unique schema.
const database = vi.hoisted(() => {
  const raw = process.env.TEST_DATABASE_URL
  if (!raw) return null
  const url = new URL(raw)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must identify a local *_test database')
  }
  const schema = `qa_${Date.now()}_${Math.random().toString(16).slice(2)}`
  url.searchParams.set('options', `-c search_path=${schema}`)
  return { url: url.toString(), schema }
})

vi.mock('../config', async importOriginal => {
  const original = await importOriginal<typeof import('../config')>()
  return { ...original, config: { ...original.config, DATABASE_URL: database?.url ?? original.config.DATABASE_URL } }
})

import { db, pool } from '../db/index'
import { initDb } from '../db/init'
import { accounts } from '../db/schema'
import { clearExpiredAccountCooldowns, disableAccount, markAccountUsed, penalizeAccount, penalizeAccountModel } from './scheduler'
import { createGroup, listGroups, updateGroup } from './groups'
import { accountHealth } from './health'
import { createApiKey, findApiKeyBySecret } from '../keys/manager'
import { cachedAntigravityModels } from './antigravityModels'
import { setAccountGroups } from './groups'

describe.runIf(database)('upstream update database regressions', () => {
  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA ${database!.schema}`)
    await initDb()
  })
  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${database!.schema} CASCADE`)
    await pool.end()
  })

  it('replays initialization and migration while preserving group policy and partial updates', async () => {
    const { id } = await createGroup({ name: 'MiniMax', allowedModels: ['MiniMax-*'], rateMultiplier: 1.2 })
    await updateGroup(id, { description: 'description only' })
    await initDb()
    const migration = await readFile(new URL('../db/migrations/0012_perpetual_wolfsbane.sql', import.meta.url), 'utf8')
    await pool.query(migration)
    await pool.query(migration)
    expect((await listGroups()).find(x => x.id === id)).toMatchObject({ allowedModels: ['MiniMax-*'], rateMultiplier: 1.2 })
    await updateGroup(id, { allowedModels: null })
    expect((await listGroups()).find(x => x.id === id)?.allowedModels).toBeNull()
    // Simulate a restored old schema: startup repairs the absent column.
    await pool.query('ALTER TABLE account_groups DROP COLUMN allowed_models')
    await initDb()
    expect((await listGroups()).find(x => x.id === id)?.allowedModels).toBeNull()
  })

  it('keeps a concurrent cooldown, never shortens it, and never revives a disabled account', async () => {
    const id = randomUUID()
    await db.insert(accounts).values({ id, name: 'race', provider: 'minimax' })
    const until = Date.now() + 86400000
    await penalizeAccount(id, 'rate_limited', until)
    await Promise.all([markAccountUsed(id), penalizeAccount(id, 'error', Date.now() + 1000)])
    let row = (await pool.query('SELECT * FROM accounts WHERE id = $1', [id])).rows[0]
    expect(row.cooldown_until).toBe(until)
    expect(row.status).not.toBe('active')
    await disableAccount(id)
    await Promise.all([markAccountUsed(id), penalizeAccount(id, 'error')])
    row = (await pool.query('SELECT * FROM accounts WHERE id = $1', [id])).rows[0]
    expect(row.status).toBe('disabled')
    expect(row.cooldown_until).toBeNull()
    await pool.query("UPDATE accounts SET status = 'rate_limited', cooldown_until = $2 WHERE id = $1", [id, Date.now() - 1000])
    await clearExpiredAccountCooldowns()
    expect((await pool.query('SELECT status FROM accounts WHERE id = $1', [id])).rows[0].status).toBe('active')
  })

  it('loads current group policy for existing keys after a group edit', async () => {
    const { id } = await createGroup({ name: 'policy', allowedModels: ['MiniMax-*'] })
    const { key } = await createApiKey({ name: 'existing key', accountGroupId: id })
    expect((await findApiKeyBySecret(key))?.groupAllowedModels).toEqual(['MiniMax-*'])
    await updateGroup(id, { allowedModels: ['claude-*'] })
    expect((await findApiKeyBySecret(key))?.groupAllowedModels).toEqual(['claude-*'])
  })

  it('does not count client cancellation as provider health degradation', async () => {
    const id = randomUUID()
    await pool.query(`INSERT INTO usage_logs (id, ts, api_key_id, account_id, provider, model, status, error_code)
      VALUES ($1, $2, 'test-key', $3, 'minimax', 'MiniMax-M3', 'error', 'client_disconnected')`, [randomUUID(), Date.now(), id])
    expect((await accountHealth([id])).get(id)?.sampleSize).toBe(0)
  })

  it('merges parallel model cooldowns without losing project metadata or shortening pauses', async () => {
    const id = randomUUID()
    await db.insert(accounts).values({ id, name: 'model-race', provider: 'antigravity', metadata: { project: 'project-1', modelCooldowns: { expired: 1, invalid: 'bad' } } })
    const until = Date.now() + 3600000
    await Promise.all([
      penalizeAccountModel(id, 'gemini-3.8-flash', 'rate_limited', until),
      penalizeAccountModel(id, 'claude-sonnet-5', 'rate_limited', until + 1000),
    ])
    await penalizeAccountModel(id, 'gemini-3.8-flash', 'error', Date.now() + 1000)
    const row = (await pool.query('SELECT metadata, status FROM accounts WHERE id = $1', [id])).rows[0]
    expect(row.metadata).toEqual({ project: 'project-1', modelCooldowns: { 'gemini-3.8-flash': until, 'claude-sonnet-5': until + 1000 } })
    expect(row.status).toBe('active')
  })

  it('does not expose another group’s native Antigravity model catalog', async () => {
    const first = await createGroup({ name: 'native-first' })
    const second = await createGroup({ name: 'native-second' })
    const id = randomUUID()
    await db.insert(accounts).values({ id, name: 'catalog', provider: 'antigravity', metadata: { antigravityModels: [{ id: 'gemini-private-test' }] } })
    await setAccountGroups(id, [first.id])
    expect(await cachedAntigravityModels(first.id)).toContain('gemini-private-test')
    expect(await cachedAntigravityModels(second.id)).toEqual([])
    expect((await cachedAntigravityModels(null)) ?? []).not.toContain('gemini-private-test')
  })
})
