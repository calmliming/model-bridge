import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => {
  const raw = process.env.TEST_DATABASE_URL
  if (!raw) return null
  const url = new URL(raw)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must identify a local *_test database')
  }
  const schema = `google_qa_${Date.now()}_${Math.random().toString(16).slice(2)}`
  url.searchParams.set('options', `-c search_path=${schema}`)
  return { url: url.toString(), schema }
})
vi.mock('../config', async original => {
  const module = await original<typeof import('../config')>()
  return { ...module, config: { ...module.config, DATABASE_URL: database?.url ?? module.config.DATABASE_URL } }
})

import { pool } from '../db/index'
import { initDb } from '../db/init'
import { acceptInvite, createUserInvite, registerUser, verifyUserCredentials } from './manager'
import { signInGoogleUser } from './google'

const identity = { sub: 'google-1', email: 'test@example.com', name: 'Google Name' }
const login = (overrides = {}) => signInGoogleUser({
  identity, registrationEnabled: true, consumeProof: async () => {}, ...overrides,
})

describe.runIf(database)('Google login against isolated PostgreSQL', () => {
  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA ${database!.schema}`)
    await initDb()
  })
  beforeEach(async () => { await pool.query('TRUNCATE users, user_invites') })
  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${database!.schema} CASCADE`)
    await pool.end()
  })

  it('upgrades and replays the migration without losing users, enforcing unique subjects', async () => {
    await pool.query('ALTER TABLE users DROP COLUMN google_sub')
    const existing = await pool.query(`INSERT INTO users (id, email, name) VALUES ('legacy', 'legacy@example.com', 'Legacy') RETURNING id`)
    await initDb()
    const migration = await readFile(new URL('../db/migrations/0011_google_sign_in.sql', import.meta.url), 'utf8')
    await pool.query(migration)
    await pool.query(migration)
    expect((await pool.query('SELECT id FROM users')).rows).toEqual(existing.rows)
    await login()
    await expect(pool.query("UPDATE users SET google_sub = 'google-1' WHERE id = 'legacy'")).rejects.toMatchObject({ code: '23505' })
  })

  it('serializes concurrent first logins and cannot adopt the resulting Google account via password signup', async () => {
    const users = await Promise.all([login(), login(), login()])
    expect(new Set(users.map(user => user.id)).size).toBe(1)
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM users')).rows[0].count).toBe(1)
    expect(users[0]).toMatchObject({ email: identity.email, balanceMicros: 0, status: 'active' })
    expect(await verifyUserCredentials(identity.email, 'attacker-password')).toBeNull()
    await expect(registerUser({ email: identity.email, password: 'attacker-password' })).rejects.toMatchObject({ statusCode: 409 })
    const changed = await login({ identity: { ...identity, email: 'changed@example.com' }, registrationEnabled: false })
    expect(changed.id).toBe(users[0]!.id)
    expect(changed.email).toBe(identity.email)
  })

  it('does not merge distinct Google subjects racing to register the same email', async () => {
    const results = await Promise.allSettled([login(), login({ identity: { ...identity, sub: 'google-2' } })])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM users')).rows[0].count).toBe(1)
  })

  it('requires the existing password, preserves balance and identity, and invalidates stale invitations', async () => {
    const local = await registerUser({ email: identity.email, name: 'Local Name', password: 'existing-password' })
    await pool.query('UPDATE users SET balance_micros = 123456 WHERE id = $1', [local.id])
    const invite = await createUserInvite({ email: identity.email, name: 'Local Name' })
    await expect(login()).rejects.toMatchObject({ statusCode: 409 })
    await expect(login({ password: 'wrong' })).rejects.toMatchObject({ statusCode: 400 })
    const linked = await login({ password: 'existing-password', registrationEnabled: false })
    expect(linked).toMatchObject({ id: local.id, name: 'Local Name', balanceMicros: 123456 })
    expect((await verifyUserCredentials(identity.email, 'existing-password'))?.id).toBe(local.id)
    await expect(acceptInvite({ token: invite.token, password: 'other-password' })).rejects.toThrow('invite already used')
  })

  it('enforces closed registration, invitation acceptance, account disablement and proof consumption', async () => {
    await expect(login({ registrationEnabled: false })).rejects.toMatchObject({ statusCode: 403 })
    await expect(login({ consumeProof: async () => { throw new Error('proof consumed') } })).rejects.toThrow('proof consumed')
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM users')).rows[0].count).toBe(0)
    const invite = await createUserInvite({ email: identity.email })
    await expect(login()).rejects.toMatchObject({ statusCode: 409 })
    await acceptInvite({ token: invite.token, password: 'invite-password' })
    const linked = await login({ password: 'invite-password', registrationEnabled: false })
    await pool.query("UPDATE users SET status = 'disabled' WHERE id = $1", [linked.id])
    await expect(login()).rejects.toMatchObject({ statusCode: 403 })
  })
})
