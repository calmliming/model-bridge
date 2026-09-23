import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * registerUser runs a real pg transaction; here we drive a faked client to
 * assert its control flow: a brand-new email inserts an active user, an email
 * that already has a password is rejected, and an invite-only row (no password)
 * is adopted rather than duplicated.
 */

const mocks = vi.hoisted(() => {
  const query = vi.fn()
  const release = vi.fn()
  const connect = vi.fn(async () => ({ query, release }))
  return { query, release, connect }
})

vi.mock('../db/index', () => ({
  pool: { connect: mocks.connect, query: mocks.query },
}))

vi.mock('bcryptjs', () => ({
  default: {
    hashSync: (pw: string) => `hashed:${pw}`,
    compareSync: (pw: string, hash: string) => hash === `hashed:${pw}`,
  },
}))

import { registerUser, userFailureCategoriesToday, userUsageDaily, userUsageSummary, UserManagerError } from './manager'

const USER_ROW = {
  id: 'u_1',
  email: 'new@example.com',
  name: 'new',
  status: 'active',
  balance_micros: 0,
  accepted_at: 1,
  last_login_at: null,
  created_at: 1,
}

/** Maps SQL fragments to canned responses; BEGIN/COMMIT/ROLLBACK are no-ops. */
function scriptQueries(handlers: Array<{ match: RegExp; rows?: unknown[]; rowCount?: number }>): void {
  mocks.query.mockImplementation(async (sql: string) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql.trim())) return { rows: [], rowCount: 0 }
    const handler = handlers.find((h) => h.match.test(sql))
    return { rows: handler?.rows ?? [], rowCount: handler?.rowCount ?? handler?.rows?.length ?? 0 }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('userUsageDaily', () => {
  it('keeps usage scoped to the user and fills missing calendar days', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-23T08:00:00Z'))
    try {
      mocks.query.mockResolvedValue({ rows: [
        { day: '2026-09-21', requests: '2', errors: '1', cost: '0.25' },
        { day: '2026-09-23', requests: '3', errors: '0', cost: '1.5' },
      ] })

      const daily = await userUsageDaily('u_1', 7)

      expect(daily).toHaveLength(7)
      expect(daily.at(-3)).toEqual({ day: '2026-09-21', requests: 2, errors: 1, cost: 0.25 })
      expect(daily.at(-2)).toEqual({ day: '2026-09-22', requests: 0, errors: 0, cost: 0 })
      expect(daily.at(-1)).toEqual({ day: '2026-09-23', requests: 3, errors: 0, cost: 1.5 })
      const [sql, values] = mocks.query.mock.calls[0] as [string, unknown[]]
      expect(sql).toContain('WHERE user_id = $1 AND ts >= $2')
      expect(sql).toContain("status = 'error'")
      expect(values[0]).toBe('u_1')
      expect(values[2]).toBe('Asia/Shanghai')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('userUsageSummary', () => {
  it('uses the same 30 calendar days as the daily trend', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-23T08:00:00Z'))
    try {
      mocks.query.mockResolvedValue({ rows: [{}] })
      await userUsageSummary('u_1')
      await userUsageDaily('u_1', 30)
      const summaryValues = mocks.query.mock.calls[0]?.[1] as unknown[]
      const dailyValues = mocks.query.mock.calls[1]?.[1] as unknown[]
      expect(summaryValues[2]).toBe(dailyValues[1])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('userFailureCategoriesToday', () => {
  it('combines raw errors into user-facing categories for the signed-in user', async () => {
    mocks.query.mockResolvedValue({ rows: [
      { error_code: 'rate_limit', upstream_status: 429, count: '2' },
      { error_code: 'quota_exceeded', upstream_status: 429, count: '1' },
      { error_code: 'server_error', upstream_status: 502, count: '1' },
    ] })
    const categories = await userFailureCategoriesToday('u_1')
    expect(categories).toEqual([
      { category: '上游限流', count: 3 },
      { category: '上游服务异常', count: 1 },
    ])
    const [sql, values] = mocks.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain("WHERE user_id = $1 AND ts >= $2 AND status = 'error'")
    expect(values[0]).toBe('u_1')
  })
})

describe('registerUser', () => {
  it('inserts a new active user for an unused email', async () => {
    scriptQueries([
      { match: /SELECT id, password_hash, status, google_sub FROM users/, rows: [] }, // no existing row
      { match: /INSERT INTO users/, rowCount: 1 },
      { match: /SELECT id, email, name, status/, rows: [USER_ROW] },
    ])

    const user = await registerUser({ email: 'New@Example.com', password: 'secret1' })

    expect(user.email).toBe('new@example.com')
    expect(user.status).toBe('active')
    expect(mocks.query).toHaveBeenCalledWith('COMMIT')
    const inserts = mocks.query.mock.calls.filter((c) => /INSERT INTO users/.test(c[0] as string))
    expect(inserts).toHaveLength(1)
  })

  it('rejects an email that already has a password (409)', async () => {
    scriptQueries([
      { match: /SELECT id, password_hash, status, google_sub FROM users/, rows: [{ id: 'u_x', password_hash: 'hashed:x', status: 'active' }] },
    ])

    await expect(registerUser({ email: 'taken@example.com', password: 'secret1' })).rejects.toMatchObject({
      statusCode: 409,
    })
    const inserts = mocks.query.mock.calls.filter((c) => /INSERT INTO users/.test(c[0] as string))
    expect(inserts).toHaveLength(0)
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK')
  })

  it('adopts an invite-only row that never set a password', async () => {
    scriptQueries([
      { match: /SELECT id, password_hash, status, google_sub FROM users/, rows: [{ id: 'u_inv', password_hash: null, status: 'active' }] },
      { match: /UPDATE users SET name = \$1, password_hash/, rowCount: 1 },
      { match: /SELECT id, email, name, status/, rows: [{ ...USER_ROW, id: 'u_inv' }] },
    ])

    const user = await registerUser({ email: 'invited@example.com', password: 'secret1', name: 'Invitee' })

    expect(user.id).toBe('u_inv')
    const inserts = mocks.query.mock.calls.filter((c) => /INSERT INTO users/.test(c[0] as string))
    expect(inserts).toHaveLength(0) // adopted, not duplicated
    expect(mocks.query).toHaveBeenCalledWith('COMMIT')
  })

  it('rejects a disabled invite-only row (403)', async () => {
    scriptQueries([
      { match: /SELECT id, password_hash, status, google_sub FROM users/, rows: [{ id: 'u_d', password_hash: null, status: 'disabled' }] },
    ])

    await expect(registerUser({ email: 'disabled@example.com', password: 'secret1' })).rejects.toMatchObject({
      statusCode: 403,
    })
  })

  it('rejects an empty email without opening a transaction', async () => {
    await expect(registerUser({ email: '   ', password: 'secret1' })).rejects.toBeInstanceOf(UserManagerError)
    expect(mocks.connect).not.toHaveBeenCalled()
  })

  it('cannot adopt a Google-only account by registering its email with a password', async () => {
    scriptQueries([
      { match: /SELECT id, password_hash, status, google_sub FROM users/, rows: [{ id: 'u_google', password_hash: null, google_sub: 'google-1', status: 'active' }] },
    ])
    await expect(registerUser({ email: 'google@example.com', password: 'attacker-password' })).rejects.toMatchObject({ statusCode: 409 })
    expect(mocks.query.mock.calls.some(([sql]) => /UPDATE users|INSERT INTO users/.test(sql))).toBe(false)
  })
})
