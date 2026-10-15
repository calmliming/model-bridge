import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RefundPaymentResult } from './providers/base'

const database = vi.hoisted(() => {
  if (!process.env.TEST_DATABASE_URL) return null
  const url = new URL(process.env.TEST_DATABASE_URL)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_test')) throw new Error('Use a local *_test database')
  const schema = `payment_qa_${Date.now()}_${Math.random().toString(16).slice(2)}`
  url.searchParams.set('options', `-c search_path=${schema}`)
  return { url: url.toString(), schema }
})
const mocks = vi.hoisted(() => ({ refund: vi.fn(), queryRefund: vi.fn(), closeOrder: vi.fn(), verifyNotification: vi.fn() }))
vi.mock('../config', async original => {
  const actual = await original<typeof import('../config')>()
  return { ...actual, config: { ...actual.config, DATABASE_URL: database?.url ?? actual.config.DATABASE_URL } }
})
vi.mock('./providers/index', () => ({ getPaymentProvider: () => mocks }))
import { pool } from '../db/index'
import { initDb } from '../db/init'
import { cancelPaymentOrder, handlePaymentNotification, queryPaymentRefund, refundPaymentOrder } from './manager'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe.runIf(database)('payment settlement integrity in PostgreSQL', () => {
  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA ${database!.schema}`)
    await initDb()
  }, 30_000)
  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${database!.schema} CASCADE`)
    await pool.end()
  })
  beforeEach(async () => {
    vi.resetAllMocks()
    await pool.query('TRUNCATE payment_refunds, payment_orders, payment_notification_events, wallet_transactions, users')
    await pool.query("INSERT INTO users (id,email,name,balance_micros) VALUES ('user_1','payment@example.com','Payment',10000000)")
    await pool.query(`INSERT INTO payment_orders
      (id,user_id,provider,status,amount_micros,provider_order_id,provider_amount,provider_currency,expires_at)
      VALUES ('po_1','user_1','alipay_web','paid',10000000,'trade_1','72.00','CNY',$1)`, [Date.now() + 60_000])
  })

  async function snapshot() {
    return {
      balance: Number((await pool.query("SELECT balance_micros FROM users WHERE id='user_1'")).rows[0].balance_micros),
      refunds: (await pool.query('SELECT * FROM payment_refunds')).rows,
      transactions: (await pool.query('SELECT * FROM wallet_transactions')).rows,
      order: (await pool.query("SELECT * FROM payment_orders WHERE id='po_1'")).rows[0],
    }
  }

  it.each(['unknown', 'error'] as const)('settles once when an overlapping refund retry finishes with %s', async late => {
    const first = deferred<RefundPaymentResult>()
    const second = deferred<RefundPaymentResult>()
    mocks.refund.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const a = refundPaymentOrder({ id: 'po_1', amount: 1, outRequestNo: 'rf_1' })
    await vi.waitFor(() => expect(mocks.refund).toHaveBeenCalledTimes(1))
    const b = refundPaymentOrder({ id: 'po_1', amount: 1, outRequestNo: 'rf_1' }).catch(error => error)
    await vi.waitFor(() => expect(mocks.refund).toHaveBeenCalledTimes(2))
    first.resolve({ outRequestNo: 'rf_1', status: 'succeeded', providerAmount: '7.20', rawData: {} })
    await a
    if (late === 'error') second.reject(new Error('gateway timeout'))
    else second.resolve({ outRequestNo: 'rf_1', status: 'unknown', rawData: {} })
    await b
    await expect(queryPaymentRefund({ id: 'po_1', outRequestNo: 'rf_1' })).resolves.toMatchObject({ status: 'succeeded' })
    const state = await snapshot()
    expect(state.balance).toBe(9_000_000)
    expect(state.transactions).toHaveLength(1)
    expect(state.refunds[0].status).toBe('succeeded')
    expect(state.order.refunded_amount_micros).toBe(1_000_000)
  })

  it('does not debit again when recovering a historical regressed refund status', async () => {
    mocks.refund.mockResolvedValue({ outRequestNo: 'rf_1', status: 'succeeded', providerAmount: '7.20', rawData: {} })
    await refundPaymentOrder({ id: 'po_1', amount: 1, outRequestNo: 'rf_1' })
    await pool.query("UPDATE payment_refunds SET status='unknown', created_at=$1 WHERE id='rf_1'", [Date.now() - 60_000])
    mocks.queryRefund.mockResolvedValue({ status: 'succeeded', providerAmount: '7.20', rawData: {} })
    await queryPaymentRefund({ id: 'po_1', outRequestNo: 'rf_1' })
    const state = await snapshot()
    expect(state.balance).toBe(9_000_000)
    expect(state.transactions).toHaveLength(1)
    expect(state.refunds[0].status).toBe('succeeded')
    expect(state.order.refunded_amount_micros).toBe(1_000_000)
  })

  it('credits concurrent verified callbacks for a historically canceled order exactly once', async () => {
    await pool.query("UPDATE payment_orders SET status='canceled' WHERE id='po_1'")
    mocks.verifyNotification.mockResolvedValue({ orderId: 'po_1', providerOrderId: 'trade_1', status: 'success', paidProviderAmount: '72.00', rawData: {} })
    await Promise.all([1, 2].map(id => handlePaymentNotification({ provider: 'alipay', data: { notify_id: `notification_${id}` } })))
    const state = await snapshot()
    expect(state.balance).toBe(20_000_000)
    expect(state.transactions).toHaveLength(1)
    expect(state.order.status).toBe('paid')
  })

  it('retains a paid state when callback settlement races gateway close', async () => {
    await pool.query("UPDATE payment_orders SET status='pending' WHERE id='po_1'")
    const close = deferred<Record<string, unknown>>()
    mocks.closeOrder.mockReturnValue(close.promise)
    const cancel = cancelPaymentOrder({ id: 'po_1', canceledBy: 'admin' })
    await vi.waitFor(() => expect(mocks.closeOrder).toHaveBeenCalledOnce())
    mocks.verifyNotification.mockResolvedValue({ orderId: 'po_1', providerOrderId: 'trade_1', status: 'success', paidProviderAmount: '72.00', rawData: {} })
    await handlePaymentNotification({ provider: 'alipay', data: { notify_id: 'paid' } })
    close.resolve({})
    await expect(cancel).resolves.toMatchObject({ status: 'paid' })
    const state = await snapshot()
    expect(state.order.status).toBe('paid')
    expect(state.transactions).toHaveLength(1)
    expect(state.balance).toBe(20_000_000)
  })
})
