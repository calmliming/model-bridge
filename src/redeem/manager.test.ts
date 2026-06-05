import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * These tests exercise the control flow of redeemCode against a faked pg
 * client. The real concurrency guarantee comes from Postgres evaluating
 * `UPDATE ... WHERE status='unused' RETURNING` atomically; here we assert that
 * the manager reacts correctly to each outcome of that statement (claim hit,
 * 0-row claim, expiry) and that codes are matched case/separator-insensitively.
 */

const mocks = vi.hoisted(() => {
  const query = vi.fn()
  const release = vi.fn()
  const connect = vi.fn(async () => ({ query, release }))
  return {
    query,
    release,
    connect,
    applyWalletTransactionWithClient: vi.fn(),
  }
})

vi.mock('../db/index', () => ({
  pool: { connect: mocks.connect, query: mocks.query },
}))

vi.mock('../wallet/manager', () => ({
  applyWalletTransactionWithClient: mocks.applyWalletTransactionWithClient,
}))

import { generateRedeemCodes, redeemCode, RedeemError } from './manager'

/** Drives the fake client: a sequence of responses matched to SQL fragments. */
function scriptQueries(handlers: Array<{ match: RegExp; rows?: unknown[]; rowCount?: number }>): void {
  mocks.query.mockImplementation(async (sql: string) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql.trim())) return { rows: [], rowCount: 0 }
    const handler = handlers.find((h) => h.match.test(sql))
    if (!handler) return { rows: [], rowCount: 0 }
    return { rows: handler.rows ?? [], rowCount: handler.rowCount ?? handler.rows?.length ?? 0 }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('redeemCode', () => {
  it('credits the wallet and reports the new balance on a successful claim', async () => {
    scriptQueries([
      { match: /UPDATE redeem_codes\s+SET status = 'used'/, rows: [{ id: 'rc_1', type: 'balance', value_micros: 5_000_000, expires_at: null }] },
      { match: /UPDATE redeem_codes SET wallet_txn_id/, rowCount: 1 },
    ])
    mocks.applyWalletTransactionWithClient.mockResolvedValue({
      id: 'txn_1',
      balanceAfterMicros: 15_000_000,
      balanceAfter: 15,
    })

    const result = await redeemCode('user_1', 'ABCDEF-123456')

    expect(result).toEqual({ valueMicros: 5_000_000, value: 5, balanceMicros: 15_000_000, balance: 15 })
    expect(mocks.applyWalletTransactionWithClient).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'user_1', type: 'credit', amountMicros: 5_000_000 }),
    )
    // A successful redemption must commit.
    expect(mocks.query).toHaveBeenCalledWith('COMMIT')
  })

  it('rejects an already-used code with 409 and never credits', async () => {
    scriptQueries([
      { match: /UPDATE redeem_codes\s+SET status = 'used'/, rows: [] }, // 0-row claim
      { match: /SELECT status FROM redeem_codes/, rows: [{ status: 'used' }] },
    ])

    await expect(redeemCode('user_1', 'USED-CODE')).rejects.toMatchObject({ statusCode: 409 })
    expect(mocks.applyWalletTransactionWithClient).not.toHaveBeenCalled()
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK')
  })

  it('rejects an unknown code with 404', async () => {
    scriptQueries([
      { match: /UPDATE redeem_codes\s+SET status = 'used'/, rows: [] },
      { match: /SELECT status FROM redeem_codes/, rows: [] },
    ])

    await expect(redeemCode('user_1', 'NOPE')).rejects.toMatchObject({ statusCode: 404 })
    expect(mocks.applyWalletTransactionWithClient).not.toHaveBeenCalled()
  })

  it('rolls back and rejects when the claimed code is expired', async () => {
    scriptQueries([
      { match: /UPDATE redeem_codes\s+SET status = 'used'/, rows: [{ id: 'rc_2', type: 'balance', value_micros: 1_000_000, expires_at: Date.now() - 1000 }] },
    ])

    await expect(redeemCode('user_1', 'EXPIRED')).rejects.toThrow(RedeemError)
    // Expired code must not be charged, and the claim is rolled back so it stays unused.
    expect(mocks.applyWalletTransactionWithClient).not.toHaveBeenCalled()
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK')
  })

  it('rejects an empty code without touching the database', async () => {
    await expect(redeemCode('user_1', '   ')).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.connect).not.toHaveBeenCalled()
  })

  it('looks codes up by a normalized hash (case- and separator-insensitive)', async () => {
    const hashes: string[] = []
    mocks.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql.trim())) return { rows: [], rowCount: 0 }
      if (/UPDATE redeem_codes\s+SET status = 'used'/.test(sql)) {
        hashes.push(params?.[2] as string) // code_hash bind param
        return { rows: [], rowCount: 0 }
      }
      return { rows: [], rowCount: 0 }
    })

    await redeemCode('u', 'abcdef-123456').catch(() => {})
    await redeemCode('u', 'ABCDEF123456').catch(() => {})
    await redeemCode('u', '  abc def-123 456 ').catch(() => {})

    expect(hashes).toHaveLength(3)
    expect(new Set(hashes).size).toBe(1) // all three normalize to the same hash
  })
})

describe('generateRedeemCodes', () => {
  it('rejects an out-of-range count', async () => {
    await expect(generateRedeemCodes({ count: 0, valueUsd: 5 })).rejects.toThrow(RedeemError)
    await expect(generateRedeemCodes({ count: 1001, valueUsd: 5 })).rejects.toThrow(RedeemError)
  })

  it('rejects a non-positive value', async () => {
    await expect(generateRedeemCodes({ count: 1, valueUsd: 0 })).rejects.toThrow(RedeemError)
  })

  it('rejects an expiry in the past', async () => {
    await expect(
      generateRedeemCodes({ count: 1, valueUsd: 5, expiresAt: Date.now() - 1000 }),
    ).rejects.toThrow(RedeemError)
  })

  it('inserts the requested number of codes and returns their plaintext once', async () => {
    scriptQueries([{ match: /INSERT INTO redeem_codes/, rowCount: 1 }])

    const { batchId, codes } = await generateRedeemCodes({ count: 3, valueUsd: 5 })

    expect(codes).toHaveLength(3)
    expect(batchId).toMatch(/^batch_/)
    expect(new Set(codes).size).toBe(3) // codes are unique
    const inserts = mocks.query.mock.calls.filter((c) => /INSERT INTO redeem_codes/.test(c[0] as string))
    expect(inserts).toHaveLength(3)
  })
})
