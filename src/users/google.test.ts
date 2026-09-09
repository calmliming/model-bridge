import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), getUserById: vi.fn() }))
vi.mock('../db/index', () => ({ pool: { connect: async () => ({ query: mocks.query, release: mocks.release }) } }))
vi.mock('./manager', async original => ({ ...await original<typeof import('./manager')>(), getUserById: mocks.getUserById }))
vi.mock('bcryptjs', () => ({ default: { compareSync: (password: string, hash: string) => hash === `hashed:${password}` } }))
import { signInGoogleUser } from './google'

const user = { id: 'user-1', email: 'local@example.com', name: 'Local', status: 'active', balanceMicros: 50_000 }
const identity = { sub: 'google-1', email: 'local@example.com', name: 'Google Name' }
let linked: Record<string, unknown> | undefined
let existing: Record<string, unknown> | undefined
let consumeProof: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.clearAllMocks()
  linked = undefined
  existing = undefined
  consumeProof = vi.fn().mockResolvedValue(undefined)
  mocks.getUserById.mockResolvedValue(user)
  mocks.query.mockImplementation(async (sql: string) => ({ rows: /WHERE google_sub/.test(sql)
    ? (linked ? [linked] : []) : /WHERE email/.test(sql) ? (existing ? [existing] : []) : [] }))
})
const signIn = (overrides = {}) => signInGoogleUser({ identity, registrationEnabled: true, consumeProof, ...overrides })
function mutations() { return mocks.query.mock.calls.filter(([sql]) => /^(INSERT|UPDATE)/.test(sql)) }

describe('Google user registration and explicit linking', () => {
  it('creates a zero-balance passwordless user when registration is open', async () => {
    await expect(signIn()).resolves.toEqual(user)
    const insert = mutations().find(([sql]) => sql.startsWith('INSERT INTO users'))!
    expect(insert[0]).not.toContain('password_hash')
    expect(insert[1]).toEqual([expect.any(String), identity.email, identity.name, identity.sub, expect.any(Number)])
    expect(consumeProof).toHaveBeenCalledTimes(1)
    expect(mocks.query).toHaveBeenCalledWith('COMMIT')
    expect(mocks.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['google:google-1'])
  })
  it('rejects first signup when registration is closed', async () => {
    await expect(signIn({ registrationEnabled: false })).rejects.toMatchObject({ statusCode: 403 })
    expect(mutations()).toHaveLength(0)
    expect(consumeProof).not.toHaveBeenCalled()
  })
  it('logs in by stable subject when Google email changes and registration closes', async () => {
    linked = { ...user, google_sub: identity.sub }
    await signIn({ identity: { ...identity, email: 'changed@example.com' }, registrationEnabled: false })
    expect(mocks.query.mock.calls.some(([sql]) => /WHERE email/.test(sql))).toBe(false)
    expect(mutations().some(([sql]) => /SET email|SET name|balance_micros/.test(sql))).toBe(false)
  })
  it.each(['linked', 'existing'])('blocks disabled %s users', async kind => {
    if (kind === 'linked') linked = { ...user, status: 'disabled' }
    else existing = { ...user, status: 'disabled' }
    await expect(signIn()).rejects.toMatchObject({ statusCode: 403 })
    expect(consumeProof).not.toHaveBeenCalled()
    expect(mutations()).toHaveLength(0)
  })
  it('requires the existing password, without consuming the proof or auto-linking email', async () => {
    existing = { ...user, password_hash: 'hashed:secret' }
    await expect(signIn()).rejects.toMatchObject({ statusCode: 409, name: 'Error' })
    expect(mutations()).toHaveLength(0)
    expect(consumeProof).not.toHaveBeenCalled()
  })
  it('rejects the wrong password and allows a confirmation retry', async () => {
    existing = { ...user, password_hash: 'hashed:secret' }
    await expect(signIn({ password: 'wrong' })).rejects.toMatchObject({ statusCode: 400 })
    expect(consumeProof).not.toHaveBeenCalled()
    expect(mutations()).toHaveLength(0)
  })
  it('links after password confirmation even if registration is closed, preserving account data', async () => {
    existing = { ...user, password_hash: 'hashed:secret' }
    await signIn({ password: 'secret', registrationEnabled: false })
    expect(mutations()).toHaveLength(2)
    expect(mutations()[0]![0]).toContain('UPDATE users SET google_sub')
    expect(mutations()[0]![0]).not.toMatch(/password_hash|SET email|SET name|balance_micros/)
    expect(mutations()[1]![0]).toContain('UPDATE user_invites SET accepted_at')
  })
  it('does not bypass an invitation or relink a different Google identity', async () => {
    existing = { ...user, password_hash: null }
    await expect(signIn()).rejects.toMatchObject({ statusCode: 409 })
    existing = { ...user, google_sub: 'other', password_hash: 'hashed:secret' }
    await expect(signIn({ password: 'secret' })).rejects.toMatchObject({ statusCode: 409 })
    expect(mutations()).toHaveLength(0)
  })
  it('makes no changes if the proof was consumed by a concurrent request', async () => {
    consumeProof.mockRejectedValue(new Error('replayed'))
    await expect(signIn()).rejects.toThrow('replayed')
    expect(mutations()).toHaveLength(0)
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK')
    expect(mocks.release).toHaveBeenCalled()
  })
  it('reports a concurrent email registration conflict without issuing a session', async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('INSERT INTO users')) throw { code: '23505' }
      return { rows: [] }
    })
    await expect(signIn()).rejects.toMatchObject({ statusCode: 409 })
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK')
    expect(mocks.getUserById).not.toHaveBeenCalled()
  })
})
