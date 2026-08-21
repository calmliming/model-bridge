import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    consumeSubscriptionUsage: vi.fn(),
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
  consumeSubscriptionUsage: mocks.consumeSubscriptionUsage,
}))

import { recordUsage, waitForPendingUsage } from './recorder'

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

function insertParams(): unknown[] {
  const call = mocks.query.mock.calls.find((c) => /INSERT INTO usage_logs/.test(c[0] as string))
  return (call?.[1] as unknown[]) ?? []
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.query.mockResolvedValue({ rows: [], rowCount: 0 })
  mocks.consumeSubscriptionUsage.mockResolvedValue(true)
})

describe('recordUsage', () => {
  it('applies the group multiplier to the base cost and stores both', async () => {
    mocks.estimateCost.mockReturnValue(2)
    await recordUsage(baseRecord({ multiplier: 1.5 }))

    const params = insertParams()
    expect(params[19]).toBe(3)
    expect(params[20]).toBe(2)
    const quotaUpdate = mocks.query.mock.calls.find((c) => /UPDATE api_keys SET quota_used/.test(c[0] as string))
    expect(quotaUpdate?.[1]?.[0]).toBe(3)
    expect(mocks.debitWalletForUsage).toHaveBeenCalledWith(expect.anything(), 'u_1', expect.any(String), 3)
    expect(mocks.query).toHaveBeenCalledWith('COMMIT')
  })

  it('defaults to 1x when no multiplier is given', async () => {
    mocks.estimateCost.mockReturnValue(4)
    await recordUsage(baseRecord())
    expect(insertParams().slice(19, 21)).toEqual([4, 4])
  })

  it('treats a non-positive or non-finite multiplier as 1x', async () => {
    mocks.estimateCost.mockReturnValue(5)
    await recordUsage(baseRecord({ multiplier: 0 }))
    expect(insertParams()[19]).toBe(5)

    vi.clearAllMocks()
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 })
    mocks.estimateCost.mockReturnValue(5)
    await recordUsage(baseRecord({ multiplier: Number.NaN }))
    expect(insertParams()[19]).toBe(5)
  })

  it('discounts below 1x', async () => {
    mocks.estimateCost.mockReturnValue(10)
    await recordUsage(baseRecord({ multiplier: 0.8 }))
    expect(insertParams().slice(19, 21)).toEqual([8, 10])
  })

  it('does not debit the wallet when there is no userId', async () => {
    mocks.estimateCost.mockReturnValue(2)
    await recordUsage(baseRecord({ userId: null, multiplier: 2 }))
    expect(mocks.debitWalletForUsage).not.toHaveBeenCalled()
    expect(insertParams()[19]).toBe(4)
  })

  it('bills a subscription request to the subscription, not the wallet', async () => {
    mocks.estimateCost.mockReturnValue(2)
    await recordUsage(baseRecord({ billTo: 'subscription', subscriptionId: 's_1', multiplier: 1.5 }))
    expect(insertParams()[21]).toBe('subscription')
    expect(mocks.consumeSubscriptionUsage).toHaveBeenCalledWith(expect.anything(), 's_1', 3)
    expect(mocks.debitWalletForUsage).not.toHaveBeenCalled()
  })

  it('falls back to the wallet when the exact request cost exceeds subscription headroom', async () => {
    mocks.estimateCost.mockReturnValue(2)
    mocks.consumeSubscriptionUsage.mockResolvedValue(false)
    await recordUsage(baseRecord({ billTo: 'subscription', subscriptionId: 's_1' }))
    expect(insertParams()[21]).toBe('balance')
    expect(mocks.debitWalletForUsage).toHaveBeenCalledWith(expect.anything(), 'u_1', expect.any(String), 2)
  })

  it('falls back to wallet when a subscriptionId is missing', async () => {
    mocks.estimateCost.mockReturnValue(2)
    await recordUsage(baseRecord({ billTo: 'subscription', subscriptionId: null }))
    expect(insertParams()[21]).toBe('balance')
    expect(mocks.consumeSubscriptionUsage).not.toHaveBeenCalled()
    expect(mocks.debitWalletForUsage).toHaveBeenCalled()
  })

  it('bills to balance by default', async () => {
    mocks.estimateCost.mockReturnValue(2)
    await recordUsage(baseRecord())
    expect(insertParams()[21]).toBe('balance')
    expect(mocks.debitWalletForUsage).toHaveBeenCalled()
    expect(mocks.consumeSubscriptionUsage).not.toHaveBeenCalled()
  })

  it('stores non-sensitive sticky session diagnostics', async () => {
    mocks.estimateCost.mockReturnValue(0)
    await recordUsage(baseRecord({
      sessionKeyHash: '0123456789abcdef',
      sessionSource: 'prompt_cache_key',
    }))
    expect(insertParams()[7]).toBe('0123456789abcdef')
    expect(insertParams()[8]).toBe('prompt_cache_key')
  })

  it('stores image token and output metadata', async () => {
    mocks.estimateCost.mockReturnValue(1)
    await recordUsage(baseRecord({
      usage: {
        ...USAGE,
        imageInputTokens: 12,
        imageOutputTokens: 34,
        imageCount: 2,
        imageSize: '1024x1024',
        imageModel: 'gpt-image-2',
      },
    }))
    expect(insertParams().slice(14, 19)).toEqual([12, 34, 2, '1024x1024', 'gpt-image-2'])
  })

  it('stores bounded failure tracing and upstream model audit fields', async () => {
    mocks.estimateCost.mockReturnValue(0)
    await recordUsage(baseRecord({
      status: 'error',
      errorCode: ' rate_limit_error ',
      errorMessage: 'safe failure',
      upstreamStatus: 429,
      attemptCount: 3,
      upstreamModel: ' gpt-5.4 ',
      modelMismatch: true,
    }))
    expect(insertParams().slice(23, 29)).toEqual([
      'rate_limit_error',
      'safe failure',
      429,
      3,
      'gpt-5.4',
      true,
    ])
  })

  it('returns false when persistence fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.estimateCost.mockReturnValue(2)
    mocks.query.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(recordUsage(baseRecord())).resolves.toBe(false)
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK')
    errorSpy.mockRestore()
  })

  it('drains usage writes that are still pending', async () => {
    mocks.estimateCost.mockReturnValue(0)
    let unblockConnect!: () => void
    const blocked = new Promise<void>((resolve) => {
      unblockConnect = resolve
    })
    mocks.connect.mockImplementationOnce(async () => {
      await blocked
      return { query: mocks.query, release: mocks.release }
    })

    const write = recordUsage(baseRecord())
    let drained = false
    const drain = waitForPendingUsage().then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)

    unblockConnect()
    await Promise.all([write, drain])
    expect(drained).toBe(true)
  })
})
