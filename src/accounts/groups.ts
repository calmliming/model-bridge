import { randomBytes } from 'node:crypto'
import { and, count, desc, eq, sql } from 'drizzle-orm'
import { db, pool } from '../db/index'
import { accountGroupMembers, accountGroups, accounts } from '../db/schema'

export interface CreateGroupInput {
  name: string
  description?: string | null
  rateMultiplier?: number
}

export interface UpdateGroupPatch {
  name?: string
  description?: string | null
  rateMultiplier?: number
}

/** Clamps a billing multiplier to a sane range. Allows discounts (<1). */
function normalizeMultiplier(value: number | undefined, fallback = 1): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(100, Math.max(0.0001, value))
}

/** Creates an account group and returns its id. */
export async function createGroup(input: CreateGroupInput): Promise<{ id: string }> {
  const id = `grp_${randomBytes(9).toString('hex')}`
  await db.insert(accountGroups).values({
    id,
    name: input.name,
    description: input.description ?? null,
    rateMultiplier: normalizeMultiplier(input.rateMultiplier),
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
      rateMultiplier: accountGroups.rateMultiplier,
      createdAt: accountGroups.createdAt,
      accountCount: count(accountGroupMembers.accountId),
    })
    .from(accountGroups)
    .leftJoin(accountGroupMembers, eq(accountGroupMembers.groupId, accountGroups.id))
    .groupBy(accountGroups.id)
    .orderBy(desc(accountGroups.createdAt))
}

/** Updates a group's name/description/multiplier. Only provided fields change. */
export async function updateGroup(id: string, patch: UpdateGroupPatch): Promise<void> {
  const set: Record<string, unknown> = {}
  if (patch.name !== undefined) set.name = patch.name
  if (patch.description !== undefined) set.description = patch.description
  if (patch.rateMultiplier !== undefined) set.rateMultiplier = normalizeMultiplier(patch.rateMultiplier)
  if (Object.keys(set).length === 0) return
  await db.update(accountGroups).set(set).where(eq(accountGroups.id, id))
}

/**
 * Deletes a group. Its membership rows and any key binding fall back to the
 * default pool in the same transaction, so no row is left pointing at a
 * missing group.
 */
export async function deleteGroup(id: string): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM account_group_members WHERE group_id = $1', [id])
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

// GROUP_MEMBERS_APPEND_MARKER

/** Replaces the full set of groups an account belongs to (membership weights reset). */
export async function setAccountGroups(accountId: string, groupIds: string[]): Promise<void> {
  const unique = [...new Set(groupIds.filter(Boolean))]
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM account_group_members WHERE account_id = $1', [accountId])
    for (const groupId of unique) {
      await client.query(
        `INSERT INTO account_group_members (account_id, group_id) VALUES ($1, $2)
         ON CONFLICT (account_id, group_id) DO NOTHING`,
        [accountId, groupId],
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** Lists the members of a group with each member's effective in-group weight. */
export async function listGroupMembers(groupId: string) {
  return db
    .select({
      accountId: accountGroupMembers.accountId,
      name: accounts.name,
      provider: accounts.provider,
      status: accounts.status,
      // Effective weight: per-membership override, else the account's base weight.
      weight: sql<number>`COALESCE(${accountGroupMembers.weight}, ${accounts.weight})`,
      overridden: sql<boolean>`${accountGroupMembers.weight} IS NOT NULL`,
    })
    .from(accountGroupMembers)
    .innerJoin(accounts, eq(accounts.id, accountGroupMembers.accountId))
    .where(eq(accountGroupMembers.groupId, groupId))
    .orderBy(desc(sql`COALESCE(${accountGroupMembers.weight}, ${accounts.weight})`))
}

/** Sets (or clears, when null) one member's in-group weight override. */
export async function setMemberWeight(
  groupId: string,
  accountId: string,
  weight: number | null,
): Promise<void> {
  const normalized = weight == null ? null : Math.max(1, Math.min(100, Math.trunc(weight)))
  await db
    .update(accountGroupMembers)
    .set({ weight: normalized })
    .where(and(eq(accountGroupMembers.groupId, groupId), eq(accountGroupMembers.accountId, accountId)))
}

