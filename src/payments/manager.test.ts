import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const query = vi.fn()
  const release = vi.fn()
  const connect = vi.fn(async () => ({ query, release }))
  return {
    query,
    release,
    connect,
    verifyNotification: vi.fn(),
    applyWalletTransactionWithClient: vi.fn(),
  }
})

vi.mock('../db/index', () => ({
  pool: { query: mocks.query, connect: mocks.connect },
}))

vi.mock('../wallet/manager', () => ({
  applyWalletTransactionWithClient: mocks.applyWalletTransactionWithClient,
}))

vi.mock('./providers/index', () => ({
  getPaymentProvider: vi.fn(() => ({ verifyNotification: mocks.verifyNotification })),
}))

import { handlePaymentNotification } from './manager'

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'po_1',
    user_id: 'user_1',
    provider: 'alipay',
    status: 'pending',
    amount_micros: 10_000_000,
    provider_order_id: 'po_1',
    payment_url: 'https://pay.example/1',
    wallet_transaction_id: null,
    note: null,
    expires_at: Date.now() + 60_000,
    paid_at: null,
    canceled_at: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  }
}

function scriptOrder(row: Record<string, unknown>) {
  mocks.query.mockImplementation(async (sql: string) => {
    const normalized = sql.trim()
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(normalized)) return { rows: [], rowCount: 0 }
    if (/SELECT id, user_id, provider, status/.test(sql)) return { rows: [row], rowCount: 1 }
    if (/INSERT INTO payment_notification_events/.test(sql)) return { rows: [], rowCount: 1 }
    if (/UPDATE payment_orders/.test(sql)) return { rows: [], rowCount: 1 }
    return { rows: [], rowCount: 0 }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.verifyNotification.mockResolvedValue({
    providerOrderId: 'trade_1',
    orderId: 'po_1',
    status: 'success',
    paidAmount: 10,
    paidAt: 1_700_000_000_000,
    rawData: {},
  })
  mocks.applyWalletTransactionWithClient.mockResolvedValue({ id: 'wallet_1' })
})

describe('handlePaymentNotification', () => {
  it('locks and credits a matching pending order once', async () => {
    scriptOrder(order())

    await expect(handlePaymentNotification({ provider: 'alipay', data: {} })).resolves.toEqual({
      success: true,
      orderId: 'po_1',
    })
    expect(mocks.query.mock.calls.find((call) => /SELECT id, user_id/.test(call[0] as string))?.[0]).toMatch(/FOR UPDATE/)
    expect(mocks.applyWalletTransactionWithClient).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'user_1', amountMicros: 10_000_000 }),
    )
    expect(mocks.query).toHaveBeenCalledWith('COMMIT')
  })

  it('treats a matching paid callback as idempotent', async () => {
    scriptOrder(order({ status: 'paid', provider_order_id: 'trade_1' }))

    await expect(handlePaymentNotification({ provider: 'alipay', data: {} })).resolves.toEqual({
      success: true,
      orderId: 'po_1',
    })
    expect(mocks.applyWalletTransactionWithClient).not.toHaveBeenCalled()
    expect(mocks.query).toHaveBeenCalledWith('COMMIT')
  })

  it('rejects a callback whose amount does not match the order', async () => {
    scriptOrder(order())
    mocks.verifyNotification.mockResolvedValue({
      providerOrderId: 'trade_1',
      orderId: 'po_1',
      status: 'success',
      paidAmount: 9,
      rawData: {},
    })

    await expect(handlePaymentNotification({ provider: 'alipay', data: {} })).rejects.toMatchObject({
      statusCode: 409,
    })
    expect(mocks.applyWalletTransactionWithClient).not.toHaveBeenCalled()
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK')
  })

  it('rejects a callback from a different provider', async () => {
    scriptOrder(order({ provider: 'wechat' }))

    await expect(handlePaymentNotification({ provider: 'alipay', data: {} })).rejects.toMatchObject({
      statusCode: 409,
    })
    expect(mocks.applyWalletTransactionWithClient).not.toHaveBeenCalled()
  })

  it('uses the persisted CNY amount for Alipay web notification checks', async () => {
    scriptOrder(order({ provider: 'alipay_web', provider_amount: '72.00' }))
    mocks.verifyNotification.mockResolvedValue({
      providerOrderId: 'trade_1',
      orderId: 'po_1',
      status: 'success',
      paidProviderAmount: '72.00',
      tradeStatus: 'TRADE_SUCCESS',
      rawData: {},
    })

    await expect(handlePaymentNotification({ provider: 'alipay', data: { notify_id: 'n1' } }))
      .resolves.toEqual({ success: true, orderId: 'po_1' })
    expect(mocks.applyWalletTransactionWithClient).toHaveBeenCalledOnce()
  })
})
