import { createHash, randomBytes } from 'node:crypto'
import { pool } from '../db/index'
import { applyWalletTransactionWithClient } from '../wallet/manager'
import { microsToUsd, usdToMicros } from '../wallet/money'

/** Redeem-code state machine: a fresh code is `unused`, becomes `used` once
 * redeemed, or `disabled` if an admin revokes it before use. */
export type RedeemCodeStatus = 'unused' | 'used' | 'disabled'
export type RedeemCodeType = 'balance'

export class RedeemError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message)
  }
}

export interface RedeemCodeView {
  id: string
  code: string | null // only present when explicitly revealed/exported
  type: RedeemCodeType
  valueMicros: number
  value: number
  status: RedeemCodeStatus
  batchId: string | null
  note: string | null
  redeemedBy: string | null
  redeemedAt: number | null
  expiresAt: number | null
  createdAt: number
}

export interface RedeemResult {
  valueMicros: number
  value: number
  balanceMicros: number
  balance: number
}

function generateId(): string {
  return `rc_${randomBytes(9).toString('hex')}`
}

/** A high-entropy, human-distributable code. Hyphen-grouped for readability. */
function generateCode(): string {
  const raw = randomBytes(15).toString('hex').toUpperCase() // 30 hex chars
  return raw.replace(/(.{6})(?=.)/g, '$1-') // ABCDEF-123456-...
}

function hashCode(code: string): string {
  return createHash('sha256').update(normalizeCode(code)).digest('hex')
}

/** Codes are matched case-insensitively and ignoring separators/whitespace. */
function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]+/g, '')
}

function asRedeemCodeView(row: Record<string, unknown>, withCode = false): RedeemCodeView {
  const valueMicros = Number(row.value_micros)
  return {
    id: row.id as string,
    code: withCode ? (row.code as string) : null,
    type: row.type as RedeemCodeType,
    valueMicros,
    value: microsToUsd(valueMicros),
    status: row.status as RedeemCodeStatus,
    batchId: (row.batch_id as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    redeemedBy: (row.redeemed_by as string | null) ?? null,
    redeemedAt: row.redeemed_at == null ? null : Number(row.redeemed_at),
    expiresAt: row.expires_at == null ? null : Number(row.expires_at),
    createdAt: Number(row.created_at),
  }
}

export interface GenerateRedeemCodesInput {
  count: number
  valueUsd: number
  expiresAt?: number | null
  note?: string | null
  createdBy?: string | null
}

/**
 * Mints a batch of balance redeem codes in one transaction. Returns the
 * plaintext codes once — they are never recoverable in plaintext from list
 * endpoints (only via explicit reveal/export).
 */
export async function generateRedeemCodes(
  input: GenerateRedeemCodesInput,
): Promise<{ batchId: string; codes: string[] }> {
  const count = Math.trunc(input.count)
  if (!Number.isFinite(count) || count < 1 || count > 1000) {
    throw new RedeemError('count must be between 1 and 1000')
  }
  const valueMicros = usdToMicros(input.valueUsd)
  if (!Number.isSafeInteger(valueMicros) || valueMicros <= 0) {
    throw new RedeemError('value must be positive')
  }
  const expiresAt = input.expiresAt ?? null
  if (expiresAt != null && (!Number.isFinite(expiresAt) || expiresAt <= Date.now())) {
    throw new RedeemError('expiresAt must be a future timestamp')
  }
  const note = input.note?.trim() || null
  const batchId = `batch_${randomBytes(6).toString('hex')}`
  const now = Date.now()

  const codes: string[] = []
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (let i = 0; i < count; i++) {
      const code = generateCode()
      await client.query(
        `INSERT INTO redeem_codes
           (id, code, code_hash, type, value_micros, status, batch_id, note,
            expires_at, created_by, created_at)
         VALUES ($1, $2, $3, 'balance', $4, 'unused', $5, $6, $7, $8, $9)`,
        [generateId(), code, hashCode(code), valueMicros, batchId, note, expiresAt, input.createdBy ?? null, now],
      )
      codes.push(code)
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
  return { batchId, codes }
}

/**
 * Atomically redeems a code into a user's wallet. The single-statement
 * `UPDATE ... WHERE status='unused' RETURNING` is the concurrency guard: only
 * one racing request can flip a code from unused to used, so a code can never
 * be double-spent. Expiry is checked after the claim; an expired code is rolled
 * back so it stays unused.
 */
export async function redeemCode(userId: string, codePlaintext: string): Promise<RedeemResult> {
  const normalized = normalizeCode(codePlaintext)
  if (!normalized) throw new RedeemError('code is required')
  const codeHash = hashCode(codePlaintext)
  const now = Date.now()

  const client = await pool.connect()
  let committed = false
  try {
    await client.query('BEGIN')
    const claimed = await client.query<Record<string, unknown>>(
      `UPDATE redeem_codes
         SET status = 'used', redeemed_by = $1, redeemed_at = $2
       WHERE code_hash = $3 AND status = 'unused'
       RETURNING id, type, value_micros, expires_at`,
      [userId, now, codeHash],
    )
    const row = claimed.rows[0]
    if (!row) {
      // Distinguish "already used / disabled" from "does not exist" for a
      // clearer message, without leaking whether unknown codes exist.
      const existing = await client.query<Record<string, unknown>>(
        'SELECT status FROM redeem_codes WHERE code_hash = $1',
        [codeHash],
      )
      await client.query('ROLLBACK')
      committed = true
      const status = existing.rows[0]?.status as RedeemCodeStatus | undefined
      if (status === 'used') throw new RedeemError('code has already been redeemed', 409)
      if (status === 'disabled') throw new RedeemError('code is disabled', 409)
      throw new RedeemError('invalid redeem code', 404)
    }

    const expiresAt = row.expires_at == null ? null : Number(row.expires_at)
    if (expiresAt != null && expiresAt < now) {
      await client.query('ROLLBACK')
      committed = true
      throw new RedeemError('code has expired', 409)
    }

    const valueMicros = Number(row.value_micros)
    const txn = await applyWalletTransactionWithClient(client, {
      userId,
      type: 'credit',
      amountMicros: valueMicros,
      note: `redeem code ${row.id as string}`,
      createdBy: 'redeem',
    })
    await client.query('UPDATE redeem_codes SET wallet_txn_id = $1 WHERE id = $2', [txn.id, row.id])
    await client.query('COMMIT')
    committed = true
    return {
      valueMicros,
      value: microsToUsd(valueMicros),
      balanceMicros: txn.balanceAfterMicros,
      balance: txn.balanceAfter,
    }
  } catch (err) {
    if (!committed) await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export interface ListRedeemCodesInput {
  page?: number
  pageSize?: number
  status?: RedeemCodeStatus
  batchId?: string
}

/** Paginated admin listing. Plaintext codes are withheld (use export to reveal). */
export async function listRedeemCodes(input: ListRedeemCodesInput = {}): Promise<{
  page: number
  pageSize: number
  total: number
  codes: RedeemCodeView[]
}> {
  const safePage = Math.max(1, Math.floor(Number.isFinite(input.page) ? input.page! : 1))
  const safePageSize = Math.max(1, Math.min(100, Math.floor(Number.isFinite(input.pageSize) ? input.pageSize! : 20)))
  const offset = (safePage - 1) * safePageSize

  const filters: string[] = []
  const values: unknown[] = []
  if (input.status) {
    values.push(input.status)
    filters.push(`status = $${values.length}`)
  }
  if (input.batchId) {
    values.push(input.batchId)
    filters.push(`batch_id = $${values.length}`)
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''

  const [total, rows] = await Promise.all([
    pool.query<Record<string, unknown>>(`SELECT COUNT(*) AS total FROM redeem_codes ${where}`, values),
    pool.query<Record<string, unknown>>(
      `SELECT id, type, value_micros, status, batch_id, note, redeemed_by,
              redeemed_at, expires_at, created_at
       FROM redeem_codes
       ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, safePageSize, offset],
    ),
  ])
  return {
    page: safePage,
    pageSize: safePageSize,
    total: Number(total.rows[0]?.total ?? 0),
    codes: rows.rows.map((r) => asRedeemCodeView(r)),
  }
}

/** Enables (back to unused) or disables a code. Used codes cannot change state. */
export async function setRedeemCodeStatus(id: string, status: 'unused' | 'disabled'): Promise<void> {
  const updated = await pool.query(
    `UPDATE redeem_codes SET status = $1
     WHERE id = $2 AND status IN ('unused', 'disabled')`,
    [status, id],
  )
  if (updated.rowCount === 0) {
    throw new RedeemError('code not found or already redeemed', 404)
  }
}

/** Deletes a code. Only unredeemed codes may be removed. */
export async function deleteRedeemCode(id: string): Promise<void> {
  const deleted = await pool.query(`DELETE FROM redeem_codes WHERE id = $1 AND status <> 'used'`, [id])
  if (deleted.rowCount === 0) {
    throw new RedeemError('code not found or already redeemed', 404)
  }
}

/** Returns plaintext codes for a batch, for admin export. Requires admin auth at the route. */
export async function exportRedeemCodes(batchId: string): Promise<RedeemCodeView[]> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT id, code, type, value_micros, status, batch_id, note, redeemed_by,
            redeemed_at, expires_at, created_at
     FROM redeem_codes
     WHERE batch_id = $1
     ORDER BY created_at ASC, id ASC`,
    [batchId],
  )
  return rows.map((r) => asRedeemCodeView(r, true))
}
