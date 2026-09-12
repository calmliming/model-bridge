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
import { cachedAccountCatalogs, catalogSourceKey } from './modelCatalog'
import { channelHealth, DEFAULT_HEALTH_SETTINGS, saveHealthSettings } from '../usage/channelHealth'

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

  it('isolates dynamic catalogs by current pool and excludes disabled or reconfigured accounts', async () => {
    const first = await createGroup({ name: 'catalog-first' })
    const second = await createGroup({ name: 'catalog-second' })
    const id = randomUUID()
    await db.insert(accounts).values({ id, name: 'dynamic', provider: 'openai', metadata: { modelCatalog: {
      version: 1, sourceKey: catalogSourceKey('openai', null), syncedAt: Date.now(), models: [{ id: 'gpt-private-model', context_window: 100000 }],
    } } })
    await setAccountGroups(id, [first.id])
    expect((await cachedAccountCatalogs(first.id, ['openai'])).providerModels.openai).toEqual(['gpt-private-model'])
    expect((await cachedAccountCatalogs(second.id, ['openai'])).providerModels.openai).toEqual([])
    expect((await cachedAccountCatalogs(null, ['openai'])).providerModels.openai).not.toContain('gpt-private-model')
    await disableAccount(id)
    expect((await cachedAccountCatalogs(first.id, ['openai'])).providerModels.openai).toEqual([])
    await pool.query("UPDATE accounts SET status = 'active', proxy_url = 'https://example.com' WHERE id = $1", [id])
    expect((await cachedAccountCatalogs(first.id, ['openai'])).catalogModels.openai).toBeUndefined()
  })

  it('aggregates SQL percentiles and excludes client/policy outcomes without duplicating group memberships', async () => {
    const first = await createGroup({ name: 'health-first' })
    const second = await createGroup({ name: 'health-second' })
    const id = randomUUID(), now = Date.now()
    await db.insert(accounts).values({ id, name: 'Health account', provider: 'gemini' })
    await setAccountGroups(id, [first.id, second.id])
    await saveHealthSettings(DEFAULT_HEALTH_SETTINGS)
    await pool.query(`INSERT INTO usage_logs (id, ts, api_key_id, account_id, provider, model, status, first_token_ms, latency_ms, error_code, upstream_status)
      SELECT $1 || '-' || i, $2::bigint - 1000, 'test-key', $1, 'gemini', 'gemini-health-test',
        CASE WHEN i <= 24 THEN 'success' ELSE 'error' END,
        CASE WHEN i <= 24 THEN 1000 ELSE NULL END, 5000,
        CASE WHEN i <= 24 THEN NULL WHEN i <= 27 THEN 'gemini_upstream_UNAVAILABLE'
          WHEN i <= 29 THEN 'gemini_policy_SAFETY' WHEN i <= 31 THEN 'client_disconnected' ELSE 'invalid_request_error' END,
        CASE WHEN i >= 32 THEN 400 ELSE 200 END
      FROM generate_series(1,33) i`, [id, now])
    for (const groupBy of ['account', 'provider', 'model'] as const) {
      const result = await channelHealth({ hours: 24, groupBy, groupId: first.id }, now)
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]).toMatchObject({ requests: 33, eligible: 27, failures: 3, success: 24,
        excluded: 6, canceled: 2, policy: 2, requestErrors: 2, ttftP95Ms: 1000, latencyP95Ms: 5000, ttftSamples: 24, state: 'warning' })
      expect(result.alerts).toHaveLength(1)
      expect(result.trend[0]).toMatchObject({ requests: 33, failures: 3, excluded: 6 })
    }
    expect((await channelHealth({ hours: 24, groupBy: 'account', groupId: first.id, provider: 'openai' }, now)).rows).toEqual([])
    await saveHealthSettings({ ...DEFAULT_HEALTH_SETTINGS, errorRatePercent: 20 })
    expect((await channelHealth({ hours: 24, groupBy: 'account', groupId: first.id }, now)).alerts).toEqual([])
  })
})
