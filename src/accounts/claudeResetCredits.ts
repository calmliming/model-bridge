/**
 * Claude native limit resets ("cedar_ember" grants) for OAuth accounts.
 *
 * Query reads the grant block from the OAuth usage endpoint and returns a
 * sanitized projection: grant and organization IDs never leave this module.
 * Redeem claims only the grant the upstream names as next, after a fresh
 * eligibility check, and records a per-organization fence before the
 * irreversible call so a crash or an unconfirmed result cannot lead to a
 * blind resend or a second credit being spent.
 *
 * Ported from Sub2API (claude_reset_credits.go / claude_reset_redeem.go).
 */

import { createHash, randomBytes } from 'node:crypto'
import { config } from '../config'
import { getSetting, setSetting } from '../db/settings'
import { fetchWithConnectTimeout } from '../http/upstream'
import { acquireSlot, releaseSlot } from '../middleware/limits'
import { ensureFreshToken, getAccount } from './manager'
import { clearAccountCooldown } from './scheduler'

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage?cedar_ember=1&skip_spend=1'
const PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile'
const redeemUrl = (organization: string) => `https://api.anthropic.com/api/organizations/${organization}/reset_rate_limits`
const REQUEST_TIMEOUT_MS = 25_000
const MAX_BODY_BYTES = 1 << 20
const GRANT_ID_PATTERN = /^[a-z0-9_-]{1,40}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// An unconfirmed claim blocks the organization until the upstream outcome has
// certainly settled; an explicit "unavailable" answer claimed nothing.
const UNKNOWN_FENCE_MS = 24 * 60 * 60_000
const UNAVAILABLE_FENCE_MS = 15 * 60_000
const KNOWN_REASONS = new Set([
  'no_grant', 'unknown_grant', 'not_next_grant', 'grant_id_required', 'tenure', 'other_experiment',
  'stamp_indeterminate', 'reset_unconfirmed', 'authorization_rejected', 'claim_unconfirmed',
  'upstream_unavailable', 'result_persistence_failed',
])
const KNOWN_WINDOWS = new Set(['five_hour', 'seven_day', 'seven_day_overage_included'])

export class ClaudeResetError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message)
  }
}

export interface ClaudeResetCredit {
  label: string
  resetsLeft: number
  startsAt: string | null
  expiresAt: string | null
  clears: string[]
  percentUsed: Record<string, number>
  blocking: string[]
  useRequiresLimit: boolean
  redeemable: boolean
}

export interface ClaudeResetCredits {
  eligible: boolean
  availableCount: number
  credits: ClaudeResetCredit[]
  cooldownUntil: string | null
  weeklyResetsAt: string | null
  fetchedAt: string
}

export type ClaudeResetOutcomeKind = 'reset' | 'already_used' | 'not_limited' | 'cooldown' | 'ineligible' | 'unknown'

export interface ClaudeResetOutcome {
  outcome: ClaudeResetOutcomeKind
  reason: string | null
  cleared: string[]
  cooldownUntil: string | null
  credits: ClaudeResetCredits | null
  replayed: boolean
}

interface Grant {
  id: string
  label: string
  resetsLeft: number
  startsAt: number | null
  endsAt: number | null
  clears: string[]
  paused: boolean
  usableNow: boolean
  useRequiresLimit: boolean
  percentUsed: Record<string, number>
  blocking: string[]
}

interface GrantBlock {
  eligible: boolean
  atLimit: boolean
  grants: Grant[]
  nextGrantId: string
  cooldownUntil: number | null
  weeklyResetsAt: number | null
}

interface Fence {
  operation: string
  outcome: ClaudeResetOutcomeKind
  reason: string | null
  at: number
}

type Row = Record<string, unknown>
const row = (value: unknown): Row | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null
const text = (value: unknown): string => typeof value === 'string' ? value : ''
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
const iso = (ms: number | null): string | null => ms == null ? null : new Date(ms).toISOString()

function time(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function parseGrant(value: unknown): Grant | null {
  const g = row(value)
  if (!g) return null
  const percentUsed: Record<string, number> = {}
  for (const [key, used] of Object.entries(row(g.percent_used) ?? {})) {
    if (typeof used === 'number' && used >= 0 && used <= 100) percentUsed[key] = used
  }
  return {
    id: text(g.id),
    label: text(g.label),
    resetsLeft: typeof g.resets_left === 'number' ? g.resets_left : 0,
    startsAt: time(g.starts_at),
    endsAt: time(g.ends_at),
    clears: strings(g.clears),
    paused: g.paused === true,
    usableNow: g.usable_now === true,
    // Absent means the grant may only be used once a limit is reached.
    useRequiresLimit: g.use_requires_limit !== false,
    percentUsed,
    blocking: strings(g.blocking),
  }
}

/** Parses the usage envelope; null when the account has no reset program. */
export function parseGrantBlock(body: unknown): GrantBlock | null {
  const envelope = row(body)
  if (!envelope || 'error' in envelope) throw new ClaudeResetError('上游返回的重置额度状态无效', 502)
  const raw = envelope.cedar_ember
  if (raw == null) return null
  const block = row(raw)
  if (!block || !Array.isArray(block.grants)) throw new ClaudeResetError('上游返回的重置额度列表无效', 502)
  return {
    eligible: block.eligible === true,
    atLimit: block.at_limit === true,
    grants: block.grants.map(parseGrant).filter((grant): grant is Grant => grant != null),
    nextGrantId: text(block.next_grant_id),
    cooldownUntil: time(block.cooldown_until),
    weeklyResetsAt: time(block.weekly_resets_at),
  }
}

/** A live, well-formed credit. */
function grantHeld(grant: Grant, now: number): boolean {
  return GRANT_ID_PATTERN.test(grant.id) && grant.clears.length > 0 && grant.resetsLeft > 0 && !grant.paused &&
    (grant.startsAt == null || now >= grant.startsAt) && (grant.endsAt == null || now < grant.endsAt)
}

/**
 * The single gate shared by the projection and redemption: only the upstream
 * next grant, usable now, unblocked, outside cooldown, with its at-limit
 * requirement satisfied.
 */
function grantRedeemable(block: GrantBlock, grant: Grant, now: number): boolean {
  return grantHeld(grant, now) && block.eligible && grant.usableNow && grant.id === block.nextGrantId &&
    (!grant.useRequiresLimit || block.atLimit) && grant.blocking.length === 0 &&
    (block.cooldownUntil == null || now >= block.cooldownUntil)
}

/** Sanitized view without grant or organization identifiers. */
export function projectResetCredits(block: GrantBlock | null, now: number): ClaudeResetCredits {
  const result: ClaudeResetCredits = {
    eligible: false, availableCount: 0, credits: [], cooldownUntil: null, weeklyResetsAt: null, fetchedAt: new Date(now).toISOString(),
  }
  if (!block) return result
  result.eligible = block.eligible
  if (block.cooldownUntil != null && now < block.cooldownUntil) result.cooldownUntil = iso(block.cooldownUntil)
  result.weeklyResetsAt = iso(block.weeklyResetsAt)
  for (const grant of block.grants) {
    if (!grantHeld(grant, now)) continue
    const redeemable = grantRedeemable(block, grant, now)
    result.credits.push({
      label: grant.label, resetsLeft: grant.resetsLeft, startsAt: iso(grant.startsAt), expiresAt: iso(grant.endsAt),
      clears: grant.clears, percentUsed: grant.percentUsed, blocking: grant.blocking,
      useRequiresLimit: grant.useRequiresLimit, redeemable,
    })
    if (redeemable) result.availableCount += grant.resetsLeft
  }
  return result
}

function headers(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/json',
    'content-type': 'application/json',
    'anthropic-beta': 'oauth-2025-04-20',
    'x-app': 'cli',
    'user-agent': `claude-cli/${config.CLAUDE_CLI_VERSION} (external, cli)`,
  }
}

async function readJson(response: Response): Promise<unknown> {
  const body = await response.text()
  if (body.length > MAX_BODY_BYTES) throw new ClaudeResetError('上游响应过大', 502)
  return JSON.parse(body)
}

async function loadToken(id: string): Promise<string> {
  const account = await getAccount(id)
  if (!account) throw new ClaudeResetError('账号不存在', 404)
  if (account.provider !== 'claude') throw new ClaudeResetError('该操作仅支持 Claude OAuth 账号', 400)
  try {
    return await ensureFreshToken(account)
  } catch {
    throw new ClaudeResetError('Claude 账号令牌不可用，请重新授权后再试', 503)
  }
}

async function fetchBlock(token: string): Promise<GrantBlock | null> {
  let response: Response
  try {
    response = await fetchWithConnectTimeout(USAGE_URL, { method: 'GET', headers: headers(token) }, REQUEST_TIMEOUT_MS)
  } catch {
    throw new ClaudeResetError('查询重置额度失败：无法连接上游', 503)
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new ClaudeResetError(`查询重置额度失败：上游 HTTP ${response.status}`, 502)
  }
  try {
    return parseGrantBlock(await readJson(response))
  } catch (err) {
    if (err instanceof ClaudeResetError) throw err
    throw new ClaudeResetError('上游返回的重置额度状态无效', 502)
  }
}

async function fetchOrganization(token: string): Promise<string> {
  let response: Response
  try {
    response = await fetchWithConnectTimeout(PROFILE_URL, { method: 'GET', headers: headers(token) }, REQUEST_TIMEOUT_MS)
  } catch {
    throw new ClaudeResetError('读取 Claude 组织信息失败', 503)
  }
  let organization = ''
  try {
    if (response.ok) organization = text(row(row(await readJson(response))?.organization)?.uuid)
    else await response.body?.cancel().catch(() => undefined)
  } catch {
    organization = ''
  }
  if (!UUID_PATTERN.test(organization)) throw new ClaudeResetError('读取 Claude 组织信息失败', 502)
  return organization.toLowerCase()
}

/** Reads the account's reset credits. */
export async function queryClaudeResetCredits(id: string, now = Date.now): Promise<ClaudeResetCredits> {
  const token = await loadToken(id)
  return projectResetCredits(await fetchBlock(token), now())
}

const fenceKey = (organization: string) =>
  `claude_reset_fence:${createHash('sha256').update(`claude-org:${organization}`).digest('hex')}`

async function loadFence(key: string): Promise<Fence | null> {
  const raw = await getSetting(key)
  if (!raw) return null
  try {
    const fence = row(JSON.parse(raw))
    if (fence && typeof fence.operation === 'string' && typeof fence.outcome === 'string' && typeof fence.at === 'number') {
      return { operation: fence.operation, outcome: fence.outcome as ClaudeResetOutcomeKind, reason: typeof fence.reason === 'string' ? fence.reason : null, at: fence.at }
    }
  } catch {
    // fall through
  }
  throw new ClaudeResetError('上一次重置结果需要人工核对，暂时无法兑换', 409)
}

async function saveFence(key: string, fence: Fence): Promise<void> {
  await setSetting(key, JSON.stringify(fence))
}

/** Sends the single irreversible claim. Anything not well-formed is unknown. */
async function claim(token: string, organization: string, grantId: string, operation: string): Promise<Omit<ClaudeResetOutcome, 'credits' | 'replayed'>> {
  const unknown = { outcome: 'unknown' as const, reason: 'claim_unconfirmed', cleared: [], cooldownUntil: null }
  let response: Response
  try {
    response = await fetchWithConnectTimeout(redeemUrl(organization), {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({ program: 'cedar_ember', grant_id: grantId, request_id: operation }),
    }, REQUEST_TIMEOUT_MS)
  } catch {
    return unknown
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel().catch(() => undefined)
    return { outcome: 'ineligible', reason: 'authorization_rejected', cleared: [], cooldownUntil: null }
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    return unknown
  }
  let result: Row | null
  try {
    result = row(await readJson(response))
  } catch {
    return unknown
  }
  if (!result) return unknown
  const reason = KNOWN_REASONS.has(text(result.reason)) ? text(result.reason) : null
  if (reason === 'stamp_indeterminate' || reason === 'reset_unconfirmed') return unknown
  const kind = text(result.result)
  if (kind === 'unavailable') return { outcome: 'unknown', reason: 'upstream_unavailable', cleared: [], cooldownUntil: null }
  if (!['reset', 'already_used', 'not_limited', 'cooldown', 'ineligible'].includes(kind)) return unknown
  return {
    outcome: kind as ClaudeResetOutcomeKind,
    reason,
    cleared: strings(result.cleared).filter(window => KNOWN_WINDOWS.has(window)),
    cooldownUntil: iso(time(result.cooldown_until)),
  }
}

/**
 * Redeems the next reset credit. `idempotencyKey` identifies one confirmation:
 * repeating it replays the recorded outcome instead of sending again.
 */
export async function redeemClaudeResetCredit(id: string, idempotencyKey?: string, now = Date.now): Promise<ClaudeResetOutcome> {
  const token = await loadToken(id)
  const operation = createHash('sha256')
    .update(`${id}:${idempotencyKey && /^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey) ? idempotencyKey : randomBytes(32).toString('hex')}`)
    .digest('hex')
  const accountLock = `claude-reset:account:${id}`
  if (!(await acquireSlot(accountLock, 1))) throw new ClaudeResetError('该账号正在兑换重置额度，请稍后再试', 409)
  try {
    const organization = await fetchOrganization(token)
    const key = fenceKey(organization)
    const orgLock = `claude-reset:${key}`
    if (!(await acquireSlot(orgLock, 1))) throw new ClaudeResetError('同一 Claude 组织正在兑换重置额度，请稍后再试', 409)
    try {
      const prior = await loadFence(key)
      if (prior) {
        if (prior.operation === operation) {
          // An interrupted attempt of this same confirmation: never resend.
          return { outcome: prior.outcome, reason: prior.reason, cleared: [], cooldownUntil: null, credits: null, replayed: true }
        }
        if (prior.outcome === 'unknown') {
          const fenceMs = prior.reason === 'upstream_unavailable' ? UNAVAILABLE_FENCE_MS : UNKNOWN_FENCE_MS
          if (now() < prior.at + fenceMs) {
            throw new ClaudeResetError(prior.reason === 'upstream_unavailable'
              ? '上游重置服务暂时不可用，请稍后再试'
              : '上一次重置结果尚未确认，24 小时内暂停兑换以免重复消耗', 409)
          }
        }
      }

      // Fresh eligibility check right before the irreversible call.
      const block = await fetchBlock(token)
      const grant = block?.grants.find(candidate => candidate.id === block.nextGrantId && grantRedeemable(block, candidate, now()))
      if (!block || !grant) throw new ClaudeResetError('当前没有可兑换的重置额度', 409)

      // Persist the unknown marker first: a crash after this point blocks both
      // a resend and another credit until the fence settles.
      const fence: Fence = { operation, outcome: 'unknown', reason: 'claim_unconfirmed', at: now() }
      await saveFence(key, fence)
      const result = await claim(token, organization, grant.id, operation)
      try {
        await saveFence(key, { ...fence, outcome: result.outcome, reason: result.reason })
      } catch {
        return { outcome: 'unknown', reason: 'result_persistence_failed', cleared: [], cooldownUntil: null, credits: null, replayed: false }
      }
      if (result.outcome === 'reset') await clearAccountCooldown(id).catch(() => undefined)
      let credits: ClaudeResetCredits | null = null
      if (result.outcome !== 'unknown') {
        credits = await fetchBlock(token).then(fresh => projectResetCredits(fresh, now()), () => null)
      }
      return { ...result, credits, replayed: false }
    } finally {
      await releaseSlot(orgLock)
    }
  } finally {
    await releaseSlot(accountLock)
  }
}

/** Admin-facing summary of a redemption outcome. */
export function claudeResetOutcomeMessage(outcome: ClaudeResetOutcomeKind): string {
  switch (outcome) {
    case 'reset': return '已兑换一次重置额度，限额窗口已重置'
    case 'already_used': return '该重置额度已被使用，未重复消耗'
    case 'not_limited': return '账号当前未触及限额，上游未执行重置'
    case 'cooldown': return '重置额度处于冷却期，请稍后再试'
    case 'ineligible': return '上游判定该账号当前不符合兑换条件'
    default: return '上游未确认兑换结果，24 小时内暂停再次兑换以免重复消耗'
  }
}
