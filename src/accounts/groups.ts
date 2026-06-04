import { randomBytes } from 'node:crypto'
import { count, desc, eq } from 'drizzle-orm'
import { db, pool } from '../db/index'
import { accountGroups, accounts } from '../db/schema'

export interface CreateGroupInput {
  name: string
  description?: string | null
}

export interface UpdateGroupPatch {
  name?: string
  description?: string | null
}

/** Creates an account group and returns its id. */
export async function createGroup(input: CreateGroupInput): Promise<{ id: string }> {
  const id = `grp_${randomBytes(9).toString('hex')}`
  await db.insert(accountGroups).values({
    id,
    name: input.name,
    description: input.description ?? null,
  })
  return { id }
}

/** Lists every account group with the number of accounts currently assigned. */
export async function listGroups() {
  return db
    .select({
      id: accountGroups.id,
      name: accountGroups.name,
      description: accountGroups.description,
      createdAt: accountGroups.createdAt,
      accountCount: count(accounts.id),
    })
    .from(accountGroups)
    .leftJoin(accounts, eq(accounts.groupId, accountGroups.id))
    .groupBy(accountGroups.id)
    .orderBy(desc(accountGroups.createdAt))
}

/** Updates a group's name/description. Only provided fields change. */
export async function updateGroup(id: string, patch: UpdateGroupPatch): Promise<void> {
  if (patch.name === undefined && patch.description === undefined) return
  await db.update(accountGroups).set(patch).where(eq(accountGroups.id, id))
}

/**
 * Deletes a group. Any accounts or API keys bound to it fall back to the
 * default pool (group columns nulled) in the same transaction, so no row is
 * left pointing at a missing group.
 */
export async function deleteGroup(id: string): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('UPDATE accounts SET group_id = NULL WHERE group_id = $1', [id])
    await client.query('UPDATE api_keys SET account_group_id = NULL WHERE account_group_id = $1', [id])
    await client.query('DELETE FROM account_groups WHERE id = $1', [id])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
