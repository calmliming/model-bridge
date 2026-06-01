import { randomBytes } from 'node:crypto'
import type { PoolClient } from 'pg'
import { pool } from '../db/index'
import { microsToUsd, usdToMicros } from './money'

export type WalletTransactionType = 'credit' | 'debit' | 'usage' | 'adjustment'

interface Queryable {
  query: PoolClient['query']
}

interface WalletTransactionInput {
  userId: string
  type: WalletTransactionType
  amountMicros: number
  usageLogId?: string | null
  note?: string | null
  createdBy?: string | null
}

export interface WalletTransactionView {
  id: string
  userId: string
  type: WalletTransactionType
  amountMicros: number
  amount: number
  balanceAfterMicros: number
  balanceAfter: number
  usageLogId: string | null
  note: string | null
  createdBy: string | null
  createdAt: number
}

function generateId(): string {
  return randomBytes(12).toString('hex')
}

function asWalletTransaction(row: Record<string, unknown>): WalletTransactionView {
  const amountMicros = Number(row.amount_micros)
  const balanceAfterMicros = Number(row.balance_after_micros)
  return {
    id: row.id as string,
    userId: row.user_id as string,
    type: row.type as WalletTransactionType,
    amountMicros,
    amount: microsToUsd(amountMicros),
    balanceAfterMicros,
    balanceAfter: microsToUsd(balanceAfterMicros),
    usageLogId: (row.usage_log_id as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: Number(row.created_at),
  }
}

export async function applyWalletTransactionWithClient(
  client: Queryable,
  input: WalletTransactionInput,
): Promise<WalletTransactionView> {
  if (!Number.isSafeInteger(input.amountMicros)) {
    throw new Error('amountMicros must be a safe integer')
  }
  const selected = await client.query<Record<string, unknown>>(
    'SELECT balance_micros FROM users WHERE id = $1 FOR UPDATE',
    [input.userId],
  )
  const current = selected.rows[0]
  if (!current) {
    throw new Error('user not found')
  }
  const balanceAfterMicros = Number(current.balance_micros) + input.amountMicros
  await client.query(
    'UPDATE users SET balance_micros = $1 WHERE id = $2',
    [balanceAfterMicros, input.userId],
  )
  const id = generateId()
  const inserted = await client.query<Record<string, unknown>>(
    `INSERT INTO wallet_transactions
       (id, user_id, type, amount_micros, balance_after_micros, usage_log_id, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, user_id, type, amount_micros, balance_after_micros,
               usage_log_id, note, created_by, created_at`,
    [
      id,
      input.userId,
      input.type,
      input.amountMicros,
      balanceAfterMicros,
      input.usageLogId ?? null,
      input.note ?? null,
      input.createdBy ?? null,
    ],
  )
  return asWalletTransaction(inserted.rows[0]!)
}

export async function applyWalletTransaction(
  input: WalletTransactionInput,
): Promise<WalletTransactionView> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const tx = await applyWalletTransactionWithClient(client, input)
    await client.query('COMMIT')
    return tx
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function adjustWalletUsd(input: {
  userId: string
  amount: number
  note?: string | null
  createdBy?: string | null
}): Promise<WalletTransactionView> {
  const amountMicros = usdToMicros(input.amount)
  if (amountMicros === 0) {
    throw new Error('amount must not be zero')
  }
  return applyWalletTransaction({
    userId: input.userId,
    type: amountMicros > 0 ? 'credit' : 'debit',
    amountMicros,
    note: input.note ?? null,
    createdBy: input.createdBy ?? null,
  })
}

export async function debitWalletForUsage(
  client: Queryable,
  userId: string,
  usageLogId: string,
  costUsd: number,
): Promise<void> {
  const amountMicros = usdToMicros(costUsd)
  if (amountMicros <= 0) return
  await applyWalletTransactionWithClient(client, {
    userId,
    type: 'usage',
    amountMicros: -amountMicros,
    usageLogId,
    note: 'usage charge',
    createdBy: 'system',
  })
}

export async function listWalletTransactions(
  userId: string,
  page = 1,
  pageSize = 20,
): Promise<{ page: number; pageSize: number; total: number; transactions: WalletTransactionView[] }> {
  const safePage = Math.max(1, Math.floor(Number.isFinite(page) ? page : 1))
  const safePageSize = Math.max(1, Math.min(100, Math.floor(Number.isFinite(pageSize) ? pageSize : 20)))
  const offset = (safePage - 1) * safePageSize
  const [total, rows] = await Promise.all([
    pool.query<Record<string, unknown>>(
      'SELECT COUNT(*) AS total FROM wallet_transactions WHERE user_id = $1',
      [userId],
    ),
    pool.query<Record<string, unknown>>(
      `SELECT id, user_id, type, amount_micros, balance_after_micros,
              usage_log_id, note, created_by, created_at
       FROM wallet_transactions
       WHERE user_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [userId, safePageSize, offset],
    ),
  ])
  return {
    page: safePage,
    pageSize: safePageSize,
    total: Number(total.rows[0]?.total ?? 0),
    transactions: rows.rows.map(asWalletTransaction),
  }
}
