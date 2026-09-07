import { describe, expect, it, vi } from 'vitest'
const fetchUpstream = vi.hoisted(() => vi.fn(async () => new Response('{}')))
vi.mock('../../http/upstream', () => ({ fetchWithConnectTimeout: fetchUpstream }))
import { relayClaudeMessages } from './relay'
import { config } from '../../config'

describe('Claude outbound version consistency', () => {
  it('aligns billing attribution with the actual User-Agent while preserving other content', async () => {
    const text = 'x-anthropic-billing-header: cc_version=2.1.161.a1b; cc_entrypoint=cli; cch=abc;'
    const body = { model: 'claude-fable-5-1', system: [{ type: 'text', text }],
      messages: [{ role: 'user', content: 'Keep cc_version=2.1.161 in this example.' }] }
    await relayClaudeMessages('secret', body)
    const [, init] = fetchUpstream.mock.calls[0] as unknown as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    const sent = JSON.parse(init.body as string)
    expect(headers['user-agent']).toBe(`claude-cli/${config.CLAUDE_CLI_VERSION} (external, cli)`)
    expect(sent.system[0].text).toBe(text.replace('2.1.161', config.CLAUDE_CLI_VERSION))
    expect(sent.messages).toEqual(body.messages)
    expect(body.system[0].text).toBe(text)
  })
})
