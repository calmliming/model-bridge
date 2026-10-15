import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { pool } from '../db'

const LEASE_MS = 90_000
const RENEW_TIMEOUT_MS = 10_000
const currentAdmission = new AsyncLocalStorage<string>()

export class RequestAdmissionError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message) }
}

type QueryClient = Pick<PoolClient, 'query'>

/** Same lock order for synchronous relays and durable media tasks on every replica. */
export async function lockRequestAdmission(client: QueryClient, userId: string, accountId?: string): Promise<void> {
  for (const lock of [`media-user:${userId}`, ...(accountId ? [`media-account:${accountId}`] : [])]) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lock])
  }
}

export async function activeRequestTotals(client: QueryClient, apiKeyId: string, userId: string, accountId: string | null = null) {
  const { rows } = await client.query(`WITH active AS (
    SELECT api_key_id, user_id, account_id, estimated_micros,
      CASE WHEN billing->>'billTo' = 'balance' THEN estimated_micros ELSE 0 END AS balance_reserved,
      TRUE AS media
    FROM media_tasks WHERE settled = FALSE AND (user_id = $2 OR account_id = $3)
    UNION ALL
    SELECT api_key_id, user_id, account_id, estimated_micros, balance_reserved_micros, FALSE
    FROM relay_reservations WHERE lease_expires_at > $4 AND (user_id = $2 OR account_id = $3)
  ) SELECT COUNT(*) FILTER (WHERE api_key_id = $1) AS key_count,
    COUNT(*) FILTER (WHERE user_id = $2) AS user_count,
    COUNT(*) FILTER (WHERE account_id = $3) AS account_count,
    COALESCE(SUM(estimated_micros) FILTER (WHERE api_key_id = $1), 0) AS key_reserved,
    COALESCE(SUM(balance_reserved) FILTER (WHERE user_id = $2), 0) AS reserved,
    COUNT(*) FILTER (WHERE media AND api_key_id = $1) AS key_media_count,
    COUNT(*) FILTER (WHERE media AND user_id = $2 AND balance_reserved > 0) AS balance_media_count
    FROM active`, [apiKeyId, userId, accountId, Date.now()])
  const row = rows[0]!
  return {
    keyCount: Number(row.key_count), userCount: Number(row.user_count), accountCount: Number(row.account_count),
    keyReserved: Number(row.key_reserved), balanceReserved: Number(row.reserved),
    keyMediaCount: Number(row.key_media_count), balanceMediaCount: Number(row.balance_media_count),
  }
}

export interface RelayAdmission {
  id: string
  signal: AbortSignal
  release(): Promise<void>
}

/** Track every relay, including unlimited/unpriced ones, so media sees its capacity. */
export async function admitRelayRequest(input: {
  apiKeyId: string; userId: string; keyLimit: number | null; userLimit: number | null
  estimateMicros: number; billTo: 'subscription' | 'balance'; enforceBalance: boolean
}): Promise<RelayAdmission> {
  const id = `relay_${randomUUID()}`
  const estimate = Math.max(0, Math.ceil(input.estimateMicros))
  let leaseExpiresAt = Date.now() + LEASE_MS
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await lockRequestAdmission(client, input.userId)
    const totals = await activeRequestTotals(client, input.apiKeyId, input.userId)
    if (input.userLimit != null && totals.userCount >= input.userLimit) {
      throw new RequestAdmissionError(429, 'too many concurrent requests for this user')
    }
    if (input.keyLimit != null && totals.keyCount >= input.keyLimit) {
      throw new RequestAdmissionError(429, 'too many concurrent requests for this API key')
    }
    // Fixed-price media reservations must also protect key headroom from relays.
    if (totals.keyMediaCount > 0) {
      const { rows } = await client.query('SELECT quota_limit, quota_used FROM api_keys WHERE id = $1', [input.apiKeyId])
      const budget = rows[0]
      if (budget?.quota_limit != null && Number(budget.quota_used) + (totals.keyReserved + estimate) / 1e6 > Number(budget.quota_limit)) {
        throw new RequestAdmissionError(429, 'in-flight requests have reserved the remaining API key quota')
      }
    }
    if (input.billTo === 'balance' && (input.enforceBalance || totals.balanceMediaCount > 0)) {
      const { rows } = await client.query('SELECT balance_micros FROM users WHERE id = $1 FOR UPDATE', [input.userId])
      const balance = Number(rows[0]?.balance_micros ?? 0)
      // Retain the existing optimistic first-relay policy for token estimates.
      // Once anything reserves funds, all later requests share its headroom.
      if (!rows.length || balance <= 0 || (totals.balanceReserved > 0 && balance - totals.balanceReserved < estimate)) {
        throw new RequestAdmissionError(402, 'insufficient balance: in-flight requests have reserved the remaining balance')
      }
    }
    leaseExpiresAt = Date.now() + LEASE_MS
    await client.query(`INSERT INTO relay_reservations
      (id, api_key_id, user_id, estimated_micros, balance_reserved_micros, lease_expires_at)
      VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, input.apiKeyId, input.userId, estimate, input.billTo === 'balance' ? estimate : 0, leaseExpiresAt])
    // Bound crash leftovers without deleting another live request's reservation.
    await client.query('DELETE FROM relay_reservations WHERE lease_expires_at <= $1', [Date.now()])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally { client.release() }

  const controller = new AbortController()
  let expiryTimer: ReturnType<typeof setTimeout>
  const watchExpiry = () => {
    clearTimeout(expiryTimer)
    // Abort before the last confirmed lease expires, even if a DB query hangs.
    expiryTimer = setTimeout(() => controller.abort(new Error('request reservation lease expired')),
      Math.max(0, leaseExpiresAt - Date.now() - 5_000))
    expiryTimer.unref()
  }
  watchExpiry()
  let renewing: Promise<void> | null = null
  const timer = setInterval(() => {
    if (renewing || controller.signal.aborted) return
    const now = Date.now()
    const renewedUntil = now + LEASE_MS
    let timeout: ReturnType<typeof setTimeout>
    renewing = Promise.race([
      pool.query('UPDATE relay_reservations SET lease_expires_at = $2 WHERE id = $1 AND lease_expires_at > $3', [id, renewedUntil, now]),
      new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('request reservation renewal timed out')), RENEW_TIMEOUT_MS) }),
    ])
      .then(result => {
        if (!result.rowCount) throw new Error('request reservation expired')
        if (!controller.signal.aborted) { leaseExpiresAt = renewedUntil; watchExpiry() }
      })
      .catch(error => { controller.abort(error); console.error('[admission] reservation renewal failed; aborting upstream request') })
      .finally(() => { clearTimeout(timeout); renewing = null })
  }, LEASE_MS / 3)
  timer.unref()
  return { id, signal: controller.signal, release: async () => {
    clearInterval(timer)
    clearTimeout(expiryTimer)
    await renewing
    await pool.query('DELETE FROM relay_reservations WHERE id = $1', [id])
      .catch(() => console.error('[admission] reservation release deferred until lease expiry'))
  } }
}

export function withRequestAdmission<T>(id: string, run: () => T): T {
  return currentAdmission.run(id, run)
}

/** Account capacity includes durable tasks, even when their submitting process exited. */
export async function acquireAdmittedAccount(accountId: string, limit: number | null): Promise<boolean> {
  const id = currentAdmission.getStore()
  if (!id) throw new Error('relay request has no admission reservation')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`media-account:${accountId}`])
    if (limit != null) {
      const { rows } = await client.query(`SELECT
        (SELECT COUNT(*) FROM media_tasks WHERE account_id = $1 AND settled = FALSE) +
        (SELECT COUNT(*) FROM relay_reservations WHERE account_id = $1 AND lease_expires_at > $2 AND id <> $3) AS count`,
      [accountId, Date.now(), id])
      if (Number(rows[0]!.count) >= limit) { await client.query('COMMIT'); return false }
    }
    const updated = await client.query('UPDATE relay_reservations SET account_id = $2 WHERE id = $1 AND lease_expires_at > $3', [id, accountId, Date.now()])
    if (!updated.rowCount) throw new Error('relay request reservation expired before scheduling')
    await client.query('COMMIT')
    return true
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally { client.release() }
}

export async function releaseAdmittedAccount(): Promise<void> {
  const id = currentAdmission.getStore()
  if (id) await pool.query('UPDATE relay_reservations SET account_id = NULL WHERE id = $1', [id])
}
