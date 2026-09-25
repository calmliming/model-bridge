import { beforeEach, describe, expect, it, vi } from 'vitest'
const fetchUpstream = vi.hoisted(() => vi.fn(async () => new Response('{}')))
vi.mock('../../http/upstream', () => ({ fetchWithConnectTimeout: fetchUpstream }))
import { relayClaudeMessages } from './relay'
import { config } from '../../config'
import { claudeProtocolHeaders } from './headers'

beforeEach(() => vi.clearAllMocks())

describe('Claude protocol forwarding', () => {
  it('preserves native attribution, prompt content and the client User-Agent', async () => {
    const text = 'x-anthropic-billing-header: cc_version=2.1.161.a1b; cc_entrypoint=cli; cch=abc;'
    const body = { model: 'claude-fable-5-1', system: [{ type: 'text', text }],
      messages: [{ role: 'user', content: '<system-reminder>Today’s date is 2026/09/25.</system-reminder>' }] }
    const userAgent = 'claude-cli/2.1.281 (external, cli)'
    await relayClaudeMessages('secret', body, { 'user-agent': userAgent })
    const [, init] = fetchUpstream.mock.calls[0] as unknown as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['user-agent']).toBe(userAgent)
    expect(JSON.parse(init.body as string)).toEqual(body)
    expect(body.system[0].text).toBe(text)
  })

  it.each(['user-agent', 'attribution', 'safeguards'])('preserves native request bodies identified by %s', async marker => {
    const body = {
      model: 'claude-fable-5-1', temperature: 0.2,
      system: marker === 'attribution'
        ? [{ type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.281; cch=original;' }]
        : 'Unchanged system prompt',
      ...(marker === 'safeguards' ? { safeguards: { future_setting: true } } : {}),
      tools: [{ name: 'Bash', input_schema: { type: 'object' } }],
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: '<system-reminder>Today’s date is 2026/09/25.</system-reminder>' }],
    }
    await relayClaudeMessages('secret', body, marker === 'user-agent' ? { 'user-agent': 'claude-cli/2.1.281' } : {})
    const [, init] = fetchUpstream.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual(body)
  })

  it('preserves unknown beta values and version while adding missing OAuth defaults once', async () => {
    const beta = 'future-safeguards-test, oauth-2025-04-20, future-capability-test'
    await relayClaudeMessages('upstream-secret', { model: 'claude-opus-5-5', messages: [] }, {
      'anthropic-beta': beta, 'anthropic-version': 'test-version', 'anthropic-workspace-id': 'workspace-test',
      authorization: 'Bearer client-secret', 'x-api-key': 'client-secret', cookie: 'session=private',
      host: 'modelbridge.test', 'content-length': '1',
    })
    const [, init] = fetchUpstream.mock.calls[0] as unknown as [string, RequestInit]
    const headers = new Headers(init.headers)
    expect(headers.get('anthropic-beta')?.startsWith(beta)).toBe(true)
    expect(headers.get('anthropic-beta')?.split(',').map(value => value.trim())
      .filter(value => value === 'oauth-2025-04-20')).toHaveLength(1)
    expect(headers.get('anthropic-version')).toBe('test-version')
    expect(headers.get('anthropic-workspace-id')).toBe('workspace-test')
    expect(headers.get('authorization')).toBe('Bearer upstream-secret')
    for (const name of ['x-api-key', 'cookie', 'host', 'content-length']) expect(headers.has(name)).toBe(false)
  })

  it('retains normalization and default headers for third-party clients', async () => {
    await relayClaudeMessages('secret', { model: 'claude-sonnet-5', system: 'Helpful bot', messages: [] })
    const [, init] = fetchUpstream.mock.calls[0] as unknown as [string, RequestInit]
    const headers = new Headers(init.headers)
    expect(headers.get('user-agent')).toBe(`claude-cli/${config.CLAUDE_CLI_VERSION} (external, cli)`)
    expect(headers.get('anthropic-version')).toBe('2023-06-01')
    expect(headers.get('anthropic-beta')).toContain('oauth-2025-04-20')
    expect(JSON.parse(init.body as string).system[0].text).toContain('You are Claude Code')
  })

  it('retains repeated protocol headers without copying unrelated headers', () => {
    expect(claudeProtocolHeaders({
      'anthropic-beta': ['first-test', 'second-test'], authorization: 'Bearer private',
    })).toEqual({ 'anthropic-beta': 'first-test,second-test' })
  })
})
