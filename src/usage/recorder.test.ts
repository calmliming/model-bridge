import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * recordUsage computes the user-facing cost as base list-price cost × the
 * group billing multiplier, stores both base_cost and cost, and debits the
 * wallet at the marked-up price. These tests drive a faked pg client and a
 * fixed estimateCost to assert that arithmetic and the persisted columns.
 */

const mocks = vi.hoisted(() => {
  const query = vi.fn()
  const release = vi.fn()
  const connect = vi.fn(async () => ({ query, release }))
  return {
    query,
    release,
    connect,
    estimateCost: vi.fn(),
    debitWalletForUsage: vi.fn(),
    incrementSubscriptionUsage: vi.fn(),
  }
})

vi.mock('../db/index', () => ({
  pool: { connect: mocks.connect, query: mocks.query },
}))

vi.mock('./pricing', () => ({
  estimateCost: mocks.estimateCost,
}))

vi.mock('../wallet/manager', () => ({
  debitWalletForUsage: mocks.debitWalletForUsage,
}))

vi.mock('../subscriptions/manager', () => ({
  incrementSubscriptionUsage: mocks.incrementSubscriptionUsage,
}))

import { recordUsage } from './recorder'

const USAGE = {
  inputTokens: 100,
  outputTokens: 50,
  reasoningTokens: 0,
  cacheCreateTokens: 0,
  cacheReadTokens: 0,
}

function baseRecord(overrides: Record<string, unknown> = {}) {
  return {
    apiKeyId: 'k_1',
    userId: 'u_1',
    accountId: 'a_1',
    provider: 'claude',
    model: 'claude-opus-4',
    usage: USAGE,
    status: 'success',
    latencyMs: 10,
    ...overrides,
  }
}

/** Pulls the params bound to the usage_logs INSERT. */
function insertParams(): unknown[] {
  const call = mocks.query.mock.calls.find((c) => /INSERT INTO usage_logs/.test(c[0] as string))
  return (call?.[1] as unknown[]) ?? []
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.query.mockResolvedValue({ rows: [], rowCount: 0 })
})

describe('recordUsage', () => {
  it('applies the group multiplier to the base cost and stores both', async () => {
    mocks.estimateCost.mockReturnValue(2) // base list price $2

    await recordUsage(baseRecord({ multiplier: 1.5 }))

    // INSERT params order: ...cost (idx 14), base_cost (idx 15)
    const params = insertParams()
    expect(params[14]).toBe(3) // cost = 2 × 1.5
    expect(params[15]).toBe(2) // base_cost = 2
    // Key quota and wallet are charged the sale price (cost), not base.
    const quotaUpdate = mocks.query.mock.calls.find((c) => /UPDATE api_keys SET quota_used/.test(c[0] as string))
    expect(quotaUpdate?.[1]?.[0]).toBe(3)
    expect(mocks.debitWalletForUsage).toHaveBeenCalledWith(expect.anything(), 'u_1', expect.any(String), 3)
    expect(mocks.query).toHaveBeenCalledWith('COMMIT')
  })

  it('defaults to 1× when no multiplier is given (cost === base_cost)', async () => {
    mocks.estimateCost.mockReturnValue(4)

    await recordUsage(baseRecord())

    const params = insertParams()
    expect(params[14]).toBe(4)
    expect(params[15]).toBe(4)
  })

  it('treats a non-positive or non-finite multiplier as 1×', async () => {
    mocks.estimateCost.mockReturnValue(5)

    await recordUsage(baseRecord({ multiplier: 0 }))
    expect(insertParams()[14]).toBe(5)

    vi.clearAllMocks()
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 })
    mocks.estimateCost.mockReturnValue(5)
    await recordUsage(baseRecord({ multiplier: Number.NaN }))
    expect(insertParams()[14]).toBe(5)
  })

  it('discounts below 1× (cost < base_cost)', async () => {
    mocks.estimateCost.mockReturnValue(10)

    await recordUsage(baseRecord({ multiplier: 0.8 }))

    const params = insertParams()
    expect(params[14]).toBe(8) // 10 × 0.8
    expect(params[15]).toBe(10)
  })

  it('does not debit the wallet when there is no userId', async () => {
    mocks.estimateCost.mockReturnValue(2)

    await recordUsage(baseRecord({ userId: null, multiplier: 2 }))

    expect(mocks.debitWalletForUsage).not.toHaveBeenCalled()
    // cost still recorded at the marked-up price for the usage log.
    expect(insertParams()[14]).toBe(4)
  })

  it('bills a subscription request to the subscription, not the wallet', async () => {
    mocks.estimateCost.mockReturnValue(2)

    await recordUsage(baseRecord({ billTo: 'subscription', subscriptionId: 's_1', multiplier: 1.5 }))

    const params = insertParams()
    expect(params[16]).toBe('subscription') // bill_to column
    expect(mocks.incrementSubscriptionUsage).toHaveBeenCalledWith(expect.anything(), 's_1', 3)
    expect(mocks.debitWalletForUsage).not.toHaveBeenCalled()
  })

  it('falls back to wallet when billTo is subscription but no subscriptionId', async () => {
    mocks.estimateCost.mockReturnValue(2)

    await recordUsage(baseRecord({ billTo: 'subscription', subscriptionId: null }))

    expect(insertParams()[16]).toBe('balance')
    expect(mocks.incrementSubscriptionUsage).not.toHaveBeenCalled()
    expect(mocks.debitWalletForUsage).toHaveBeenCalled()
  })

  it('bills to balance by default and records bill_to=balance', async () => {
    mocks.estimateCost.mockReturnValue(2)

    await recordUsage(baseRecord())

    expect(insertParams()[16]).toBe('balance')
    expect(mocks.debitWalletForUsage).toHaveBeenCalled()
    expect(mocks.incrementSubscriptionUsage).not.toHaveBeenCalled()
  })

  it('stores non-sensitive sticky session diagnostics when provided', async () => {
    mocks.estimateCost.mockReturnValue(0)

    await recordUsage(baseRecord({
      sessionKeyHash: '0123456789abcdef',
      sessionSource: 'prompt_cache_key',
    }))

    const params = insertParams()
    expect(params[7]).toBe('0123456789abcdef')
    expect(params[8]).toBe('prompt_cache_key')
  })

  it('returns false when persistence fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.estimateCost.mockReturnValue(2)
    mocks.query.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(recordUsage(baseRecord())).resolves.toBe(false)

    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK')
    errorSpy.mockRestore()
  })
})
