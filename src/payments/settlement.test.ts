import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RefundPaymentResult, RefundQueryResult } from './providers/base'

const mocks = vi.hoisted(() => ({
  query: vi.fn(), debit: vi.fn(), refund: vi.fn(), queryRefund: vi.fn(),
  closeOrder: vi.fn(), queryOrder: vi.fn(), verifyNotification: vi.fn(), provider: {} as Record<string, unknown>,
}))
vi.mock('../db/index', () => ({ pool: { query: mocks.query, connect: async () => ({ query: mocks.query, release() {} }) } }))
vi.mock('../wallet/manager', () => ({ applyWalletTransactionWithClient: mocks.debit }))
vi.mock('../db/settings', () => ({ isOnlinePaymentEnabled: async () => true }))
vi.mock('./providers/index', () => ({ getPaymentProvider: () => mocks.provider }))

import { cancelPaymentOrder, handlePaymentNotification, queryPaymentOrder, queryPaymentRefund, refundPaymentOrder } from './manager'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

/** A stateful database double: assertions below concern ledger/state outcomes. */
function ledger(status = 'paid', refundStatus = 'unknown') {
  const order: Record<string, unknown> = {
    id: 'po_1', user_id: 'user_1', provider: 'alipay_web', status, amount_micros: 10_000_000,
    provider_order_id: 'trade_1', provider_amount: '72.00', provider_currency: 'CNY',
    refunded_amount_micros: 0, expires_at: Date.now() + 60_000, created_at: Date.now(), updated_at: Date.now(),
  }
  const refund: Record<string, unknown> = {
    id: 'rf_1', payment_order_id: 'po_1', status: refundStatus, amount_micros: 1_000_000,
    provider_amount: '7.20', provider_currency: 'CNY', wallet_transaction_id: null,
    created_at: Date.now() - 60_000, updated_at: Date.now(),
  }
  let balance = 10_000_000
  mocks.debit.mockImplementation(async (_client, input) => {
    balance += input.amountMicros
    return { id: `wallet_${mocks.debit.mock.calls.length}` }
  })
  const row = (value: Record<string, unknown>) => ({ rows: [{ ...value }], rowCount: 1 })
  mocks.query.mockImplementation(async (sql: string, args: unknown[] = []) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())) return { rows: [], rowCount: 0 }
    if (/SELECT/.test(sql) && /FROM payment_refunds/.test(sql)) return row({ ...refund, user_id: order.user_id, provider: order.provider })
    if (/SELECT/.test(sql) && /FROM payment_orders/.test(sql)) return row(order)
    if (/INSERT INTO payment_notification_events/.test(sql)) return { rows: [], rowCount: 1 }
    if (/UPDATE payment_refunds/.test(sql)) {
      if (sql.includes("status = 'succeeded'")) {
        refund.status = 'succeeded'
        if (sql.includes('wallet_transaction_id = $1')) refund.wallet_transaction_id = args[0]
      } else {
        if (sql.includes("status <> 'succeeded'") && refund.status === 'succeeded') return { rows: [], rowCount: 0 }
        if (sql.includes('wallet_transaction_id IS NULL') && refund.wallet_transaction_id) return { rows: [], rowCount: 0 }
        refund.status = sql.includes("status = 'unknown'") ? 'unknown' : args[0]
      }
      return row(refund)
    }
    if (/UPDATE payment_orders/.test(sql)) {
      if (sql.includes('refunded_amount_micros = refunded_amount_micros +')) order.refunded_amount_micros = Number(order.refunded_amount_micros) + Number(args[0])
      if (sql.includes("SET status = 'canceled'")) {
        if (order.status !== 'pending') return { rows: [], rowCount: 0 }
        order.status = 'canceled'
      }
      if (sql.includes("SET status = 'paid'")) {
        order.status = 'paid'; order.provider_order_id = args[0]; order.wallet_transaction_id = args[1]
      }
      return row(order)
    }
    throw new Error(`Unexpected query: ${sql}`)
  })
  return { order, refund, balance: () => balance }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.provider = {
    refund: mocks.refund, queryRefund: mocks.queryRefund, closeOrder: mocks.closeOrder,
    queryOrder: mocks.queryOrder, verifyNotification: mocks.verifyNotification,
  }
})

describe('refund settlement races', () => {
  it.each(['unknown', 'error'] as const)('keeps a successful refund terminal after a late %s retry', async late => {
    const state = ledger()
    const first = deferred<RefundPaymentResult>()
    const second = deferred<RefundPaymentResult>()
    mocks.refund.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const a = refundPaymentOrder({ id: 'po_1', amount: 1, outRequestNo: 'rf_1' })
    const b = refundPaymentOrder({ id: 'po_1', amount: 1, outRequestNo: 'rf_1' })
    const bOutcome = b.catch(error => error)
    await vi.waitFor(() => expect(mocks.refund).toHaveBeenCalledTimes(2))
    first.resolve({ outRequestNo: 'rf_1', status: 'succeeded', providerAmount: '7.20', rawData: {} })
    await expect(a).resolves.toMatchObject({ status: 'succeeded' })
    if (late === 'error') second.reject(new Error('gateway timeout'))
    else second.resolve({ outRequestNo: 'rf_1', status: 'unknown', rawData: {} })
    await bOutcome
    expect(state.refund.status).toBe('succeeded')
    await expect(queryPaymentRefund({ id: 'po_1', outRequestNo: 'rf_1' })).resolves.toMatchObject({ status: 'succeeded' })
    expect(mocks.queryRefund).not.toHaveBeenCalled()
    expect(mocks.debit).toHaveBeenCalledOnce()
    expect(state.balance()).toBe(9_000_000)
    expect(state.order.refunded_amount_micros).toBe(1_000_000)
  })

  it.each(['pending', 'unknown'] as const)('ignores a late %s query after another query settles', async late => {
    const state = ledger()
    const first = deferred<RefundQueryResult>()
    const second = deferred<RefundQueryResult>()
    mocks.queryRefund.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const a = queryPaymentRefund({ id: 'po_1', outRequestNo: 'rf_1' })
    const b = queryPaymentRefund({ id: 'po_1', outRequestNo: 'rf_1' })
    await vi.waitFor(() => expect(mocks.queryRefund).toHaveBeenCalledTimes(2))
    first.resolve({ outRequestNo: 'rf_1', status: 'succeeded', providerAmount: '7.20', rawData: {} })
    await a
    second.resolve({ outRequestNo: 'rf_1', status: late, rawData: {} })
    await expect(b).resolves.toMatchObject({ status: 'succeeded' })
    expect(state.refund.status).toBe('succeeded')
    expect(mocks.debit).toHaveBeenCalledOnce()
    expect(state.balance()).toBe(9_000_000)
  })

  it('repairs an old regressed status using the committed wallet transaction without a second debit', async () => {
    const state = ledger()
    state.refund.wallet_transaction_id = 'wallet_already_settled'
    state.order.refunded_amount_micros = 1_000_000
    mocks.queryRefund.mockResolvedValue({ status: 'succeeded', providerAmount: '7.20', rawData: {} })
    await expect(queryPaymentRefund({ id: 'po_1', outRequestNo: 'rf_1' })).resolves.toMatchObject({ status: 'succeeded', walletTransactionId: 'wallet_already_settled' })
    expect(mocks.debit).not.toHaveBeenCalled()
    expect(state.order.refunded_amount_micros).toBe(1_000_000)
    expect(state.refund.status).toBe('succeeded')
  })
})

describe('canceling online payments', () => {
  it('closes the online order before canceling it locally', async () => {
    const state = ledger('pending')
    const close = deferred<Record<string, unknown>>()
    mocks.closeOrder.mockReturnValue(close.promise)
    const canceled = cancelPaymentOrder({ id: 'po_1', canceledBy: 'admin' })
    await vi.waitFor(() => expect(mocks.closeOrder).toHaveBeenCalledOnce())
    expect(state.order.status).toBe('pending')
    close.resolve({})
    await expect(canceled).resolves.toMatchObject({ status: 'canceled' })
  })

  it.each(['unsupported', 'failure'] as const)('preserves a payable order when gateway close is %s', async mode => {
    const state = ledger('pending')
    if (mode === 'unsupported') delete mocks.provider.closeOrder
    else mocks.closeOrder.mockRejectedValue(new Error('close failed'))
    await expect(cancelPaymentOrder({ id: 'po_1', canceledBy: 'admin' })).rejects.toThrow()
    expect(state.order.status).toBe('pending')
    expect(mocks.debit).not.toHaveBeenCalled()
  })

  it('still allows manual cancellation without a gateway', async () => {
    const state = ledger('pending')
    state.order.provider = 'manual'
    await expect(cancelPaymentOrder({ id: 'po_1', canceledBy: 'admin' })).resolves.toMatchObject({ status: 'canceled' })
    expect(mocks.closeOrder).not.toHaveBeenCalled()
  })

  it.each(['callback', 'query'] as const)('credits a historical locally canceled payment exactly once via %s', async mode => {
    const state = ledger('canceled')
    const notification = { orderId: 'po_1', providerOrderId: 'trade_1', status: 'success', paidProviderAmount: '72.00', rawData: {} }
    mocks.verifyNotification.mockResolvedValue(notification)
    mocks.queryOrder.mockResolvedValue(notification)
    const settle = () => mode === 'callback'
      ? handlePaymentNotification({ provider: 'alipay', data: {} })
      : queryPaymentOrder({ id: 'po_1' })
    await settle()
    await settle()
    expect(state.order.status).toBe('paid')
    expect(mocks.debit).toHaveBeenCalledOnce()
    expect(state.balance()).toBe(20_000_000)
  })

  it('does not overwrite a payment that settles while the close request is in flight', async () => {
    const state = ledger('pending')
    const close = deferred<Record<string, unknown>>()
    mocks.closeOrder.mockReturnValue(close.promise)
    const canceled = cancelPaymentOrder({ id: 'po_1', canceledBy: 'admin' })
    await vi.waitFor(() => expect(mocks.closeOrder).toHaveBeenCalledOnce())
    mocks.verifyNotification.mockResolvedValue({ orderId: 'po_1', providerOrderId: 'trade_1', status: 'success', paidProviderAmount: '72.00', rawData: {} })
    await handlePaymentNotification({ provider: 'alipay', data: {} })
    close.resolve({})
    await expect(canceled).resolves.toMatchObject({ status: 'paid' })
    expect(state.order.status).toBe('paid')
    expect(mocks.debit).toHaveBeenCalledOnce()
  })
})
