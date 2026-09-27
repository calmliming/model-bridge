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
    createPayment: vi.fn(),
    queryOrder: vi.fn(),
    isOnlinePaymentEnabled: vi.fn(),
    applyWalletTransactionWithClient: vi.fn(),
  }
})

vi.mock('../db/index', () => ({
  pool: { query: mocks.query, connect: mocks.connect },
}))

vi.mock('../wallet/manager', () => ({
  applyWalletTransactionWithClient: mocks.applyWalletTransactionWithClient,
}))

vi.mock('../db/settings', () => ({ isOnlinePaymentEnabled: mocks.isOnlinePaymentEnabled }))

vi.mock('./providers/index', () => ({
  getPaymentProvider: vi.fn(() => ({
    verifyNotification: mocks.verifyNotification,
    createPayment: mocks.createPayment,
    queryOrder: mocks.queryOrder,
  })),
}))

import { createPaymentOrder, handlePaymentNotification, queryPaymentOrder } from './manager'

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'po_1',
    user_id: 'user_1',
    provider: 'alipay',
    status: 'pending',
    amount_micros: 10_000_000,
    provider_order_id: 'po_1',
    provider_amount: '72.00',
    provider_currency: 'CNY',
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
    if (/UPDATE payment_orders/.test(sql)) return { rows: [{ ...row, status: 'paid' }], rowCount: 1 }
    return { rows: [], rowCount: 0 }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isOnlinePaymentEnabled.mockResolvedValue(true)
  mocks.verifyNotification.mockResolvedValue({
    providerOrderId: 'trade_1',
    orderId: 'po_1',
    status: 'success',
    paidAmount: 10,
    paidProviderAmount: '72.00',
    paidAt: 1_700_000_000_000,
    rawData: {},
  })
  mocks.applyWalletTransactionWithClient.mockResolvedValue({ id: 'wallet_1' })
})

describe('online payment switch', () => {
  it.each(['alipay', 'alipay_web', 'wechat'] as const)('blocks new %s orders before contacting the gateway', async provider => {
    mocks.isOnlinePaymentEnabled.mockResolvedValue(false)
    await expect(createPaymentOrder({ userId: 'user_1', amount: 1, provider })).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.createPayment).not.toHaveBeenCalled()
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('allows manual recharge orders while online payments are closed', async () => {
    mocks.isOnlinePaymentEnabled.mockResolvedValue(false)
    mocks.query.mockResolvedValue({ rows: [order({ provider: 'manual' })] })
    await expect(createPaymentOrder({ userId: 'user_1', amount: 10 })).resolves.toMatchObject({ provider: 'manual' })
    expect(mocks.isOnlinePaymentEnabled).not.toHaveBeenCalled()
    expect(mocks.createPayment).not.toHaveBeenCalled()
  })

  it('does not create orders when the switch cannot be read', async () => {
    mocks.isOnlinePaymentEnabled.mockRejectedValue(new Error('settings unavailable'))
    await expect(createPaymentOrder({ userId: 'user_1', amount: 1, provider: 'alipay' })).rejects.toThrow('settings unavailable')
    expect(mocks.createPayment).not.toHaveBeenCalled()
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('still settles verified callbacks while new payments are disabled', async () => {
    mocks.isOnlinePaymentEnabled.mockResolvedValue(false)
    scriptOrder(order())
    await expect(handlePaymentNotification({ provider: 'alipay', data: {} })).resolves.toMatchObject({ success: true })
    expect(mocks.applyWalletTransactionWithClient).toHaveBeenCalledOnce()
    expect(mocks.isOnlinePaymentEnabled).not.toHaveBeenCalled()
  })

  it('still reconciles an existing paid order through active query while disabled', async () => {
    mocks.isOnlinePaymentEnabled.mockResolvedValue(false)
    scriptOrder(order())
    mocks.queryOrder.mockResolvedValue({
      orderId: 'po_1', providerOrderId: 'trade_1', status: 'success', paidProviderAmount: '72.00',
    })
    await expect(queryPaymentOrder({ id: 'po_1', userId: 'user_1' })).resolves.toMatchObject({ status: 'paid' })
    expect(mocks.applyWalletTransactionWithClient).toHaveBeenCalledOnce()
    expect(mocks.isOnlinePaymentEnabled).not.toHaveBeenCalled()
  })
})

describe('handlePaymentNotification', () => {
  it('credits a verified payment even when local checkout expiry ran before the callback', async () => {
    scriptOrder(order({ status: 'expired', expires_at: Date.now() - 60_000 }))
    await expect(handlePaymentNotification({ provider: 'alipay', data: { notify_id: 'late-1' } }))
      .resolves.toMatchObject({ success: true })
    expect(mocks.applyWalletTransactionWithClient).toHaveBeenCalledOnce()
    const update = mocks.query.mock.calls.find(call => /SET status = 'paid'/.test(call[0] as string))
    expect(update?.[0]).toContain("status IN ('pending', 'expired')")
    expect(mocks.query).toHaveBeenCalledWith('COMMIT')
  })

  it('still rejects mismatched amounts for expired orders', async () => {
    scriptOrder(order({ status: 'expired' }))
    mocks.verifyNotification.mockResolvedValue({ orderId: 'po_1', providerOrderId: 'trade-1', status: 'success', paidAmount: 1, paidProviderAmount: '7.20' })
    await expect(handlePaymentNotification({ provider: 'alipay', data: {} })).rejects.toMatchObject({ statusCode: 409 })
    expect(mocks.applyWalletTransactionWithClient).not.toHaveBeenCalled()
  })
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
      paidProviderAmount: '64.80',
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

describe('Alipay order amounts across recharge rate changes', () => {
  it('persists the provider CNY amount separately from wallet credit', async () => {
    mocks.createPayment.mockResolvedValue({
      providerOrderId: 'po_1', paymentUrl: 'https://pay.example/1',
      providerAmount: '0.50', providerCurrency: 'CNY', expiresAt: Date.now() + 60_000,
    })
    mocks.query.mockResolvedValue({ rows: [order({ amount_micros: 500_000, provider_amount: '0.50' })] })
    const result = await createPaymentOrder({ userId: 'user_1', amount: 0.5, provider: 'alipay' })
    expect(result).toMatchObject({ amount: 0.5, providerAmount: '0.50', providerCurrency: 'CNY' })
    const insert = mocks.query.mock.calls.find(([sql]) => /INSERT INTO payment_orders/.test(sql))!
    expect(insert[1][3]).toBe(500_000)
    expect(insert[1].slice(7, 9)).toEqual(['0.50', 'CNY'])
  })

  it.each(['alipay', 'alipay_web'])('credits %s callbacks using the order amount after a rate change', async provider => {
    scriptOrder(order({ provider, amount_micros: 500_000, provider_amount: '0.50' }))
    mocks.verifyNotification.mockResolvedValue({
      orderId: 'po_1', providerOrderId: 'trade_1', status: 'success',
      paidProviderAmount: '0.50', paidAmount: 0.50 / 7.2,
    })
    await expect(handlePaymentNotification({ provider: 'alipay', data: {} })).resolves.toMatchObject({ success: true })
    expect(mocks.applyWalletTransactionWithClient).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ amountMicros: 500_000 }))
  })

  it('still credits a legacy QR order paid at 7.2 after changing the rate to 1', async () => {
    scriptOrder(order({ amount_micros: 500_000, provider_amount: null }))
    mocks.verifyNotification.mockResolvedValue({
      orderId: 'po_1', providerOrderId: 'trade_1', status: 'success',
      paidProviderAmount: '3.60', paidAmount: 3.6,
    })
    await expect(handlePaymentNotification({ provider: 'alipay', data: {} })).resolves.toMatchObject({ success: true })
    expect(mocks.applyWalletTransactionWithClient).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ amountMicros: 500_000 }))
  })

  it.each([
    ['0.50', '3.60', 0.5],
    [null, '0.50', 0.5],
    ['invalid', '0.50', 0.5],
  ])('rejects CNY mismatches even if the converted USD amount matches', async (storedAmount, paidProviderAmount, paidAmount) => {
    scriptOrder(order({ amount_micros: 500_000, provider_amount: storedAmount }))
    mocks.verifyNotification.mockResolvedValue({
      orderId: 'po_1', providerOrderId: 'trade_1', status: 'success', paidProviderAmount, paidAmount,
    })
    await expect(handlePaymentNotification({ provider: 'alipay', data: {} })).rejects.toMatchObject({ statusCode: 409 })
    expect(mocks.applyWalletTransactionWithClient).not.toHaveBeenCalled()
  })

  it('rejects missing CNY amounts instead of trusting the converted wallet amount', async () => {
    scriptOrder(order({ amount_micros: 500_000, provider_amount: '0.50' }))
    mocks.verifyNotification.mockResolvedValue({
      orderId: 'po_1', providerOrderId: 'trade_1', status: 'success', paidAmount: 0.5,
    })
    await expect(handlePaymentNotification({ provider: 'alipay', data: {} })).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.applyWalletTransactionWithClient).not.toHaveBeenCalled()
  })

  it.each([
    ['alipay', '0.50', '0.50', 0.50 / 7.2],
    ['alipay_web', '0.50', '0.50', 0.50 / 7.2],
    ['alipay', null, '3.60', 3.6],
  ])('reconciles queried %s payments using their original order terms', async (provider, storedAmount, paidProviderAmount, paidAmount) => {
    scriptOrder(order({ provider, amount_micros: 500_000, provider_amount: storedAmount }))
    mocks.queryOrder.mockResolvedValue({
      orderId: 'po_1', providerOrderId: 'trade_1', status: 'success', paidProviderAmount, paidAmount,
    })
    await expect(queryPaymentOrder({ id: 'po_1', userId: 'user_1' })).resolves.toMatchObject({ status: 'paid', amount: 0.5 })
    expect(mocks.applyWalletTransactionWithClient).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ amountMicros: 500_000 }))
  })
})
