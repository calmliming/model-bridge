import { describe, expect, it } from 'vitest'

import { normalizeClaudeMessagesBody } from './relay'

const IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude."
// 真实 Claude Code 2.1.x 的 system[0]:cch 是对整个请求体的签名,每个请求都不同。
const BILLING_BLOCK = {
  type: 'text',
  text: 'x-anthropic-billing-header: cc_version=2.1.161.a1b; cc_entrypoint=cli; cch=3f09a;',
}

describe('normalizeClaudeMessagesBody', () => {
  it('passes real Claude Code bodies through untouched (billing block first)', () => {
    const system = [
      BILLING_BLOCK,
      { type: 'text', text: IDENTITY, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'big stable prompt', cache_control: { type: 'ephemeral' } },
    ]
    const body = normalizeClaudeMessagesBody({
      model: 'claude-sonnet-4-5',
      system,
      context_management: { edits: [] },
      messages: [{ role: 'user', content: 'hello' }],
    })

    // 不能在 billing block 前插身份块:billing block 必须保持在 system[0]
    // 才会被上游剥离;被挤到中间就成了每请求变化的普通文本,毒化所有缓存前缀。
    expect(body.system).toEqual(system)
    // cch 签的是整个 body,字段级改写会让签名失效 —— 现在 beta 集合里带了
    // context-management,该字段上游可接受,不再剥离。
    expect(body.context_management).toEqual({ edits: [] })
  })

  it('recognizes sub-agent / compact identity variants anywhere in system', () => {
    const system = [
      BILLING_BLOCK,
      { type: 'text', text: 'You are a file search specialist for Claude Code', cache_control: { type: 'ephemeral' } },
    ]
    const body = normalizeClaudeMessagesBody({
      model: 'claude-haiku-4-5',
      system,
      messages: [{ role: 'user', content: 'find foo' }],
    })

    expect(body.system).toEqual(system)
  })

  it('injects the identity after a leading billing block, never before it', () => {
    const body = normalizeClaudeMessagesBody({
      model: 'claude-sonnet-4-5',
      system: [BILLING_BLOCK, { type: 'text', text: 'third-party prompt' }],
      messages: [{ role: 'user', content: 'hi' }],
    })

    const system = body.system as Array<Record<string, unknown>>
    expect(system[0]).toEqual(BILLING_BLOCK)
    expect(system[1]).toMatchObject({ type: 'text', text: IDENTITY })
  })

  it('prepends identity and adds a system cache breakpoint for plain third-party bodies', () => {
    const body = normalizeClaudeMessagesBody({
      model: 'claude-sonnet-4-5',
      system: 'you are a helpful bot',
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(body.system).toEqual([
      { type: 'text', text: IDENTITY },
      { type: 'text', text: 'you are a helpful bot', cache_control: { type: 'ephemeral' } },
    ])
  })

  it('does not add its own breakpoint when the client already manages cache_control', () => {
    const system = [
      { type: 'text', text: IDENTITY, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'client prompt' },
    ]
    const body = normalizeClaudeMessagesBody({
      model: 'claude-sonnet-4-5',
      system,
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(body.system).toEqual(system)
  })

  it('never places the relay breakpoint on a billing-header block', () => {
    const body = normalizeClaudeMessagesBody({
      model: 'claude-sonnet-4-5',
      system: [{ type: 'text', text: `${IDENTITY} Extra.` }, BILLING_BLOCK],
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(body.system).toEqual([
      { type: 'text', text: `${IDENTITY} Extra.`, cache_control: { type: 'ephemeral' } },
      BILLING_BLOCK,
    ])
  })

  it('normalizes fingerprinted datelines in system text', () => {
    const body = normalizeClaudeMessagesBody({
      model: 'claude-sonnet-5',
      system: "Today\u2019s date is 2026/07/04.",
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(body.system).toEqual([
      { type: 'text', text: IDENTITY },
      { type: 'text', text: "Today's date is 2026-07-04.", cache_control: { type: 'ephemeral' } },
    ])
  })

  it('normalizes datelines only inside system-reminder message blocks', () => {
    const body = normalizeClaudeMessagesBody({
      model: 'claude-sonnet-5',
      system: [{ type: 'text', text: IDENTITY, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content:
            "User prose: Today\u2019s date is 2026/07/04.\n<system-reminder>Today\u02bcs date is 2026/07/04.</system-reminder>",
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: "<system-reminder>Today\u02b9s date is 2026/07/05.</system-reminder>",
            },
          ],
        },
      ],
    })

    expect((body.messages as Array<{ content: string }>)[0].content).toBe(
      "User prose: Today\u2019s date is 2026/07/04.\n<system-reminder>Today's date is 2026-07-04.</system-reminder>",
    )
    expect((body.messages as Array<{ content: Array<{ text: string }> }>)[1].content[0].text).toBe(
      "<system-reminder>Today's date is 2026-07-05.</system-reminder>",
    )
  })
})
