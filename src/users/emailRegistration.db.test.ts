import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'

const database = vi.hoisted(() => {
  const raw = process.env.TEST_DATABASE_URL
  if (!raw) return null
  const url = new URL(raw)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must identify a local *_test database')
  }
  const schema = `email_qa_${Date.now()}_${Math.random().toString(16).slice(2)}`
  url.searchParams.set('options', `-c search_path=${schema}`)
  return { url: url.toString(), schema }
})
const mail = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('../config', async original => {
  const actual = await original<typeof import('../config')>()
  return { ...actual, config: { ...actual.config, DATABASE_URL: database?.url ?? actual.config.DATABASE_URL,
    RESEND_API_KEY: 'test-key', RESEND_FROM_EMAIL: 'noreply@example.test', TURNSTILE_SITE_KEY: undefined, TURNSTILE_SECRET_KEY: undefined } }
})
vi.mock('./registrationEmail', () => ({ emailRegistrationConfigured: () => true, sendRegistrationCode: mail.send }))

import { pool } from '../db/index'
import { initDb } from '../db/init'
import { setRegistrationEnabled } from '../db/settings'
import { registerAuthRoutes } from '../routes/auth'
import { resetLimits } from '../middleware/limits'
import { createUserInvite, verifyUserCredentials } from './manager'

describe.runIf(database)('email registration with isolated PostgreSQL', () => {
  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA ${database!.schema}`)
    await initDb()
  })
  beforeEach(async () => {
    mail.send.mockReset()
    mail.send.mockResolvedValue(undefined)
    await resetLimits()
    await pool.query('TRUNCATE users, user_invites, pending_user_registrations')
    await setRegistrationEnabled(true)
  })
  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${database!.schema} CASCADE`)
    await pool.end()
  })

  async function withApp(run: (app: ReturnType<typeof Fastify>) => Promise<void>) {
    const app = Fastify()
    await app.register(fastifyJwt, { secret: 'registration-test-secret' })
    registerAuthRoutes(app)
    try { await run(app) } finally { await app.close() }
  }

  const details = { email: 'New@Example.com', password: 'secret123', name: 'New User' }
  const codeFromMail = () => mail.send.mock.calls.at(-1)?.[1] as string

  it('sends a code, creates no account before verification, then consumes the code and logs in', () => withApp(async app => {
    const status = await app.inject({ method: 'GET', url: '/api/auth/registration-status' })
    expect(status.json().enabled).toBe(true)

    const started = await app.inject({ method: 'POST', url: '/api/auth/register', payload: details })
    expect(started.statusCode).toBe(202)
    expect(started.json()).toMatchObject({ verificationRequired: true, email: 'new@example.com' })
    expect(mail.send).toHaveBeenCalledWith('new@example.com', expect.stringMatching(/^\d{6}$/), expect.any(String))
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM users')).rows[0].count).toBe(0)
    const pending = (await pool.query('SELECT code_hash FROM pending_user_registrations')).rows[0]
    expect(pending.code_hash).not.toContain(codeFromMail())

    const wrongCode = codeFromMail() === '999999' ? '000000' : '999999'
    const wrong = await app.inject({ method: 'POST', url: '/api/auth/register/verify', payload: { email: details.email, code: wrongCode } })
    expect(wrong.statusCode).toBe(400)
    expect((await pool.query('SELECT attempts FROM pending_user_registrations')).rows[0].attempts).toBe(1)

    const verified = await app.inject({ method: 'POST', url: '/api/auth/register/verify', payload: { email: details.email, code: codeFromMail() } })
    expect(verified.statusCode).toBe(201)
    expect(verified.json().user).toMatchObject({ email: 'new@example.com', name: 'New User', status: 'active' })
    expect(app.jwt.verify(verified.json().token)).toMatchObject({ role: 'user', email: 'new@example.com' })
    expect(await verifyUserCredentials(details.email, details.password)).toMatchObject({ email: 'new@example.com' })
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM pending_user_registrations')).rows[0].count).toBe(0)
    const replay = await app.inject({ method: 'POST', url: '/api/auth/register/verify', payload: { email: details.email, code: codeFromMail() } })
    expect(replay.statusCode).toBe(400)
  }))

  it('enforces resend cooldown and invalidates the old code', () => withApp(async app => {
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: details })
    const oldCode = codeFromMail()
    const tooSoon = await app.inject({ method: 'POST', url: '/api/auth/register/resend', payload: { email: details.email } })
    expect(tooSoon.statusCode).toBe(429)
    await pool.query('UPDATE pending_user_registrations SET sent_at = $1', [Date.now() - 61_000])
    const resent = await app.inject({ method: 'POST', url: '/api/auth/register/resend', payload: { email: details.email } })
    expect(resent.statusCode).toBe(200)
    const newCode = codeFromMail()
    const old = await app.inject({ method: 'POST', url: '/api/auth/register/verify', payload: { email: details.email, code: oldCode } })
    expect(old.statusCode).toBe(400)
    const verified = await app.inject({ method: 'POST', url: '/api/auth/register/verify', payload: { email: details.email, code: newCode } })
    expect(verified.statusCode).toBe(201)
  }))

  it('rejects expired codes and locks out repeated guesses', () => withApp(async app => {
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: details })
    const realCode = codeFromMail()
    await pool.query('UPDATE pending_user_registrations SET expires_at = $1', [Date.now() - 1])
    expect((await app.inject({ method: 'POST', url: '/api/auth/register/verify', payload: { email: details.email, code: realCode } })).statusCode).toBe(400)
    await pool.query('UPDATE pending_user_registrations SET expires_at = $1', [Date.now() + 600_000])
    for (let i = 0; i < 5; i += 1) {
      const wrongCode = String(i).padStart(6, '0') === realCode ? '999999' : String(i).padStart(6, '0')
      expect((await app.inject({ method: 'POST', url: '/api/auth/register/verify', payload: { email: details.email, code: wrongCode } })).statusCode).toBe(400)
    }
    expect((await app.inject({ method: 'POST', url: '/api/auth/register/verify', payload: { email: details.email, code: realCode } })).statusCode).toBe(429)
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM users')).rows[0].count).toBe(0)
  }))

  it('fails closed when sending fails or registration is switched off', () => withApp(async app => {
    mail.send.mockRejectedValueOnce(new Error('provider unavailable'))
    const failed = await app.inject({ method: 'POST', url: '/api/auth/register', payload: details })
    expect(failed.statusCode).toBe(503)
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM pending_user_registrations')).rows[0].count).toBe(0)
    await setRegistrationEnabled(false)
    expect((await app.inject({ method: 'POST', url: '/api/auth/register', payload: details })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: '/api/auth/register/verify', payload: { email: details.email, code: '123456' } })).statusCode).toBe(403)
  }))

  it('adopts an invitation only after email verification and rejects an existing account', () => withApp(async app => {
    const invite = await createUserInvite({ email: details.email })
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: details })
    const verified = await app.inject({ method: 'POST', url: '/api/auth/register/verify', payload: { email: details.email, code: codeFromMail() } })
    expect(verified.statusCode).toBe(201)
    expect(verified.json().user.id).toBe(invite.user.id)
    expect((await pool.query('SELECT accepted_at FROM user_invites WHERE user_id = $1', [invite.user.id])).rows[0].accepted_at).not.toBeNull()
    expect((await app.inject({ method: 'POST', url: '/api/auth/register', payload: details })).statusCode).toBe(409)
  }))
})
