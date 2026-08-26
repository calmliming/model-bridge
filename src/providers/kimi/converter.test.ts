import { describe, expect, it } from 'vitest'
import { mapModel, responsesToChatCompletions } from './converter'

describe('kimi mapModel', () => {
  it('passes through kimi* and moonshot* model names', () => {
    expect(mapModel('kimi-k3')).toBe('kimi-k3')
    expect(mapModel('kimi-k3[1m]')).toBe('kimi-k3[1m]')
    expect(mapModel('kimi-k2.7-code')).toBe('kimi-k2.7-code')
    expect(mapModel('moonshot-v1-128k')).toBe('moonshot-v1-128k')
  })

  it('maps Kimi Code K3 aliases to the native K3 identifier', () => {
    expect(mapModel('k3')).toBe('kimi-k3')
    expect(mapModel('k3-256k')).toBe('kimi-k3')
    expect(mapModel('kimi-code/k3')).toBe('kimi-k3')
  })

  it('rewrites unknown / Codex model names to the flagship', () => {
    expect(mapModel('gpt-5.5')).toBe('kimi-k3')
    expect(mapModel('')).toBe('kimi-k3')
    expect(mapModel(undefined)).toBe('kimi-k3')
  })
})

describe('kimi responsesToChatCompletions', () => {
  it('maps instructions + string input into system/user messages', () => {
    const out = responsesToChatCompletions({
      model: 'kimi-k3',
      instructions: 'be terse',
      input: 'hello',
      stream: true,
    })
    expect(out.model).toBe('kimi-k3')
    expect(out.stream).toBe(true)
    expect(out.messages).toEqual([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hello' },
    ])
  })

  it('enforces uniform reasoning_content across assistant messages', () => {
    const out = responsesToChatCompletions({
      model: 'kimi-k3',
      input: [
        { type: 'reasoning', summary: [{ type: 'summary_text', text: 'think' }] },
        { type: 'message', role: 'assistant', content: 'with reasoning' },
        { type: 'message', role: 'assistant', content: 'without reasoning' },
      ],
    })
    const assistants = out.messages.filter((m) => m.role === 'assistant')
    expect(assistants).toHaveLength(2)
    expect(assistants[0]!.reasoning_content).toBe('think')
    // The second assistant must be backfilled so Kimi's all-or-nothing rule holds.
    expect(assistants[1]!.reasoning_content).toBe('')
  })
})
