import { pool } from '../db'
import { digest, managementError } from './access'
import type { ManagementPrincipal } from './permissions'

/** Persist the claim before an upstream side effect; uncertain work never runs again. */
export async function idempotentManagement<T>(principal: ManagementPrincipal, key: unknown, operation: string, input: unknown, work: () => Promise<T>): Promise<T> {
  if (typeof key !== 'string' || !/^[A-Za-z0-9:_-]{8,128}$/.test(key)) throw managementError('A valid Idempotency-Key is required for this operation', 400)
  const id = digest(principal.actor + ':' + key)
  const fingerprint = digest(JSON.stringify({ operation, input, policy: principal.policy }))
  const claimed = await pool.query(`INSERT INTO management_idempotency(id,fingerprint,status,created_at)
    VALUES($1,$2,'pending',$3) ON CONFLICT DO NOTHING RETURNING id`, [id, fingerprint, Date.now()])
  if (!claimed.rows.length) {
    const { rows } = await pool.query('SELECT fingerprint,status,response FROM management_idempotency WHERE id=$1', [id])
    const previous = rows[0]
    if (!previous || previous.fingerprint !== fingerprint) throw managementError('Idempotency key conflicts with another request or permission policy', 409)
    if (previous.status === 'completed') return previous.response as T
    throw managementError('Operation pending or outcome uncertain; query its result before creating a new operation', 409)
  }
  try {
    const result = await work()
    await pool.query("UPDATE management_idempotency SET status='completed',response=$2::jsonb WHERE id=$1", [id, JSON.stringify(result)])
    return result
  } catch (error) {
    await pool.query("UPDATE management_idempotency SET status='uncertain' WHERE id=$1", [id]).catch(() => {})
    throw error
  }
}
