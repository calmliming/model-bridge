import { BlockList, isIP } from 'node:net'
import { z } from 'zod'

export const permissionIds = ['accounts.read', 'accounts.status.write', 'accounts.quota.read', 'accounts.quota.reset', 'accounts.import', 'groups.read', 'users.read', 'usage.read', 'audit.read'] as const
export type ManagementPermission = typeof permissionIds[number]
export const policySchema = z.object({
  permissions: z.array(z.enum(permissionIds)).min(1).max(permissionIds.length),
  accountIds: z.array(z.string().min(1).max(100)).max(1000).nullable().default(null),
  groupIds: z.array(z.string().min(1).max(100)).max(1000).nullable().default(null),
}).strict()
export type ManagementPolicy = z.infer<typeof policySchema>
export interface ManagementPrincipal { actor: string; policy: ManagementPolicy }

export function validIpRule(rule: string): boolean {
  const [address, prefix, extra] = rule.split('/')
  if (rule.split('/').length > 2) return false
  const family = isIP(address ?? '')
  return !extra && !!family && (prefix === undefined || (/^\d+$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128)))
}
export function ipAllowed(ip: string, rules: string[]): boolean {
  if (!rules.length) return true
  const block = new BlockList()
  for (const rule of rules) {
    if (!validIpRule(rule)) return false
    const [address, prefix] = rule.split('/')
    const family = isIP(address!) === 4 ? 'ipv4' : 'ipv6'
    if (prefix === undefined) block.addAddress(address!, family)
    else block.addSubnet(address!, Number(prefix), family)
  }
  const address = ip.replace(/^::ffff:/, '')
  return !!isIP(address) && block.check(address, isIP(address) === 4 ? 'ipv4' : 'ipv6')
}

/** Both dimensions constrain the same account; no cross-rule permission assembly. */
export function accountScope(policy: ManagementPolicy, startAt = 1, alias = 'a') {
  return { sql: `($${startAt}::text[] IS NULL OR ${alias}.id = ANY($${startAt}))
    AND ($${startAt + 1}::text[] IS NULL OR EXISTS (SELECT 1 FROM account_group_members m WHERE m.account_id = ${alias}.id AND m.group_id = ANY($${startAt + 1})))`,
    values: [policy.accountIds, policy.groupIds] }
}
