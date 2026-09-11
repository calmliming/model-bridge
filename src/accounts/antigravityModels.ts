import { and, eq, ne, notExists, sql } from 'drizzle-orm'
import { db } from '../db'
import { accounts, accountGroupMembers } from '../db/schema'

/** Cached discovery is scoped to the same account pool used by relay selection. */
export async function cachedAntigravityModels(groupId: string | null): Promise<string[] | null> {
  const inGroup = groupId ? sql`EXISTS (SELECT 1 FROM account_group_members m WHERE m.account_id = ${accounts.id} AND m.group_id = ${groupId})`
    : notExists(db.select({ one: sql`1` }).from(accountGroupMembers).where(eq(accountGroupMembers.accountId, accounts.id)))
  const rows = await db.select({ metadata: accounts.metadata }).from(accounts)
    .where(and(eq(accounts.provider, 'antigravity'), ne(accounts.status, 'disabled'), inGroup))
  if (!rows.length) return []
  let observed = false
  const ids = new Set<string>()
  for (const row of rows) {
    const models = (row.metadata as { antigravityModels?: unknown } | null)?.antigravityModels
    if (!Array.isArray(models)) continue
    observed = true
    for (const model of models.slice(0, 300)) {
      if (model && typeof model.id === 'string' && /^(gemini|claude)-[a-z\d._-]+$/i.test(model.id)) ids.add(model.id)
    }
  }
  return observed ? [...ids] : null
}
