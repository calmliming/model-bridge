import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  account: { id: 'acc-1', provider: 'claude' } as Record<string, unknown> | null,
  settings: new Map<string, string>(),
  fetch: vi.fn(),
  clearAccountCooldown: vi.fn(),
}))

vi.mock('./manager', () => ({
  getAccount: async () => mocks.account,
  ensureFreshToken: async () => 'oauth-token',
}))
vi.mock('./scheduler', () => ({ clearAccountCooldown: mocks.clearAccountCooldown }))
vi.mock('../db/settings', () => ({
  getSetting: async (key: string) => mocks.settings.get(key),
  setSetting: async (key: string, value: string) => { mocks.settings.set(key, value) },
}))
vi.mock('../http/upstream', () => ({ fetchWithConnectTimeout: mocks.fetch }))

import { ClaudeResetError, projectResetCredits, parseGrantBlock, queryClaudeResetCredits, redeemClaudeResetCredit } from './claudeResetCredits'
import { resetLimits } from '../middleware/limits'

const NOW = Date.parse('2026-10-01T00:00:00Z')
const ORG = '123e4567-e89b-12d3-a456-426614174000'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function grant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'grant_next', label: 'Weekly reset', resets_left: 2, starts_at: '2026-09-01T00:00:00Z', ends_at: '2026-12-01T00:00:00Z',
    clears: ['five_hour', 'seven_day'], paused: false, usable_now: true, percent_used: { seven_day: 100, bogus: 150 }, blocking: [],
    ...overrides,
  }
}

function usage(block: Record<string, unknown> | null) {
  return { five_hour: { utilization: 100 }, cedar_ember: block }
}

const redeemableBlock = { eligible: true, at_limit: true, next_grant_id: 'grant_next', grants: [grant(), grant({ id: 'grant_later' })] }

/** Routes mocked upstream calls by URL; `claim` decides the redeem answer. */
function upstream(options: { block?: Record<string, unknown> | null; claim?: () => Response | Promise<Response> } = {}) {
  mocks.fetch.mockImplementation(async (url: string) => {
    if (url.includes('/api/oauth/profile')) return json({ organization: { uuid: ORG } })
    if (url.includes('/api/oauth/usage')) return json(usage(options.block === undefined ? redeemableBlock : options.block))
    if (url.includes('/reset_rate_limits')) return options.claim ? options.claim() : json({ result: 'reset', cleared: ['five_hour', 'grant_secret'] })
    throw new Error(`unexpected ${url}`)
  })
}

const claimCalls = () => mocks.fetch.mock.calls.filter(([url]) => String(url).includes('/reset_rate_limits'))

beforeEach(async () => {
  vi.clearAllMocks()
  await resetLimits()
  mocks.account = { id: 'acc-1', provider: 'claude' }
  mocks.settings.clear()
  mocks.clearAccountCooldown.mockResolvedValue(undefined)
})

describe('projectResetCredits', () => {
  it('exposes only the next usable grant as redeemable and never leaks grant ids', () => {
    const credits = projectResetCredits(parseGrantBlock(usage(redeemableBlock)), NOW)
    expect(credits).toMatchObject({ eligible: true, availableCount: 2 })
    expect(credits.credits.map(credit => credit.redeemable)).toEqual([true, false])
    expect(credits.credits[0]!.percentUsed).toEqual({ seven_day: 100 })
    expect(JSON.stringify(credits)).not.toContain('grant_')
  })

  it('applies the at-limit, blocking, cooldown and validity gates', () => {
    const project = (block: Record<string, unknown>) => projectResetCredits(parseGrantBlock(usage({ ...redeemableBlock, ...block })), NOW)
    expect(project({ at_limit: false }).availableCount).toBe(0)
    expect(project({ at_limit: false, grants: [grant({ use_requires_limit: false })] }).availableCount).toBe(2)
    expect(project({ grants: [grant({ blocking: ['tenure'] })] }).availableCount).toBe(0)
    expect(project({ cooldown_until: '2026-10-01T01:00:00Z' })).toMatchObject({ availableCount: 0, cooldownUntil: '2026-10-01T01:00:00.000Z' })
    expect(project({ grants: [grant({ ends_at: '2026-09-30T00:00:00Z' }), grant({ id: 'BAD ID' }), grant({ paused: true })] }).credits).toEqual([])
  })

  it('reports no program and rejects malformed envelopes', () => {
    expect(projectResetCredits(parseGrantBlock(usage(null)), NOW)).toMatchObject({ eligible: false, credits: [] })
    expect(() => parseGrantBlock({ error: { type: 'x' } })).toThrow(ClaudeResetError)
    expect(() => parseGrantBlock(usage({ eligible: true }))).toThrow(ClaudeResetError)
  })
})

describe('queryClaudeResetCredits', () => {
  it('queries the usage endpoint with the OAuth token', async () => {
    upstream()
    const credits = await queryClaudeResetCredits('acc-1', () => NOW)
    expect(credits.availableCount).toBe(2)
    const [url, init] = mocks.fetch.mock.calls[0]!
    expect(url).toBe('https://api.anthropic.com/api/oauth/usage?cedar_ember=1&skip_spend=1')
    expect(init.headers).toMatchObject({ authorization: 'Bearer oauth-token', 'anthropic-beta': 'oauth-2025-04-20' })
  })

  it('rejects non-Claude accounts and upstream failures', async () => {
    mocks.account = { id: 'acc-1', provider: 'openai' }
    await expect(queryClaudeResetCredits('acc-1')).rejects.toMatchObject({ statusCode: 400 })
    mocks.account = { id: 'acc-1', provider: 'claude' }
    mocks.fetch.mockResolvedValue(new Response('nope', { status: 500 }))
    await expect(queryClaudeResetCredits('acc-1')).rejects.toMatchObject({ statusCode: 502 })
  })
})

describe('redeemClaudeResetCredit', () => {
  it('claims only the next grant, records the fence and clears the local cooldown', async () => {
    upstream()
    const result = await redeemClaudeResetCredit('acc-1', 'confirm-0001', () => NOW)
    expect(result).toMatchObject({ outcome: 'reset', cleared: ['five_hour'], replayed: false })
    expect(result.credits?.availableCount).toBe(2)
    const [url, init] = claimCalls()[0]!
    expect(url).toBe(`https://api.anthropic.com/api/organizations/${ORG}/reset_rate_limits`)
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ program: 'cedar_ember', grant_id: 'grant_next' })
    expect(body.request_id).toMatch(/^[0-9a-f]{64}$/)
    expect([...mocks.settings.values()].map(value => JSON.parse(value).outcome)).toEqual(['reset'])
    expect(mocks.clearAccountCooldown).toHaveBeenCalledWith('acc-1')
    expect(JSON.stringify(result)).not.toContain('grant_next')
  })

  it('does not send a claim when nothing is redeemable', async () => {
    upstream({ block: { ...redeemableBlock, at_limit: false } })
    await expect(redeemClaudeResetCredit('acc-1', 'confirm-0001', () => NOW)).rejects.toMatchObject({ statusCode: 409 })
    expect(claimCalls()).toHaveLength(0)
    expect(mocks.settings.size).toBe(0)
  })

  it('fences the organization after an unconfirmed claim and replays the same confirmation', async () => {
    upstream({ claim: () => { throw new Error('socket hang up') } })
    expect(await redeemClaudeResetCredit('acc-1', 'confirm-0001', () => NOW)).toMatchObject({ outcome: 'unknown', reason: 'claim_unconfirmed' })
    upstream()
    // The same confirmation never resends.
    expect(await redeemClaudeResetCredit('acc-1', 'confirm-0001', () => NOW + 1_000)).toMatchObject({ outcome: 'unknown', replayed: true })
    // A new confirmation is blocked for 24 hours, then allowed after a fresh check.
    await expect(redeemClaudeResetCredit('acc-1', 'confirm-0002', () => NOW + 60_000)).rejects.toMatchObject({ statusCode: 409 })
    expect(claimCalls()).toHaveLength(1)
    expect(await redeemClaudeResetCredit('acc-1', 'confirm-0003', () => NOW + 24 * 3_600_000 + 1)).toMatchObject({ outcome: 'reset' })
  })

  it('fences briefly after an explicit unavailable answer', async () => {
    upstream({ claim: () => json({ result: 'unavailable' }) })
    expect(await redeemClaudeResetCredit('acc-1', 'confirm-0001', () => NOW)).toMatchObject({ outcome: 'unknown', reason: 'upstream_unavailable' })
    upstream()
    await expect(redeemClaudeResetCredit('acc-1', 'confirm-0002', () => NOW + 60_000)).rejects.toMatchObject({ statusCode: 409 })
    expect(await redeemClaudeResetCredit('acc-1', 'confirm-0003', () => NOW + 15 * 60_000)).toMatchObject({ outcome: 'reset' })
  })

  it('maps authorization rejections and unknown reasons without echoing upstream values', async () => {
    upstream({ claim: () => new Response('', { status: 403 }) })
    expect(await redeemClaudeResetCredit('acc-1', 'confirm-0001', () => NOW)).toMatchObject({ outcome: 'ineligible', reason: 'authorization_rejected' })
    mocks.settings.clear()
    upstream({ claim: () => json({ result: 'cooldown', reason: 'grant_next leaked', cooldown_until: '2026-10-02T00:00:00Z' }) })
    expect(await redeemClaudeResetCredit('acc-1', 'confirm-0002', () => NOW)).toMatchObject({ outcome: 'cooldown', reason: null, cooldownUntil: '2026-10-02T00:00:00.000Z' })
    expect(mocks.clearAccountCooldown).not.toHaveBeenCalled()
  })

  it('refuses an invalid organization before touching the fence', async () => {
    mocks.fetch.mockImplementation(async (url: string) => url.includes('/profile') ? json({ organization: { uuid: 'not-a-uuid' } }) : json(usage(redeemableBlock)))
    await expect(redeemClaudeResetCredit('acc-1', 'confirm-0001', () => NOW)).rejects.toMatchObject({ statusCode: 502 })
    expect(mocks.settings.size).toBe(0)
  })
})
