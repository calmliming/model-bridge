import { describe, expect, it } from 'vitest'
import { mapModel, responsesToChatCompletions } from './converter'

describe('xiaomi mapModel', () => {
  it('passes through mimo-* model names', () => {
    expect(mapModel('mimo-v2.6-pro-ultraspeed')).toBe('mimo-v2.6-pro-ultraspeed')
    expect(mapModel('mimo-v2.6-flash')).toBe('mimo-v2.6-flash')
    expect(mapModel('mimo-v2.5-tts')).toBe('mimo-v2.5-tts')
  })

  it('rewrites retired V2.5 names to their V2.6 successors', () => {
    expect(mapModel('mimo-v2.5-pro')).toBe('mimo-v2.6-pro')
    expect(mapModel('mimo-v2.5')).toBe('mimo-v2.6-flash')
    expect(mapModel('mimo-V2.5-Pro')).toBe('mimo-v2.6-pro')
  })

  it('rewrites unknown / Codex model names to the V2.6 flagship', () => {
    expect(mapModel('gpt-5.5')).toBe('mimo-v2.6-pro')
    expect(mapModel('')).toBe('mimo-v2.6-pro')
    expect(mapModel(undefined)).toBe('mimo-v2.6-pro')
  })
})

describe('xiaomi responsesToChatCompletions', () => {
  it('maps instructions + string input into system/user messages', () => {
    const out = responsesToChatCompletions({
      model: 'mimo-v2.6-flash',
      instructions: 'be terse',
      input: 'hello',
      stream: true,
    })
    expect(out.model).toBe('mimo-v2.6-flash')
    expect(out.stream).toBe(true)
    expect(out.messages).toEqual([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hello' },
    ])
  })

  it('enforces uniform reasoning_content across assistant messages', () => {
    const out = responsesToChatCompletions({
      model: 'mimo-v2.6-pro',
      input: [
        { type: 'reasoning', summary: [{ type: 'summary_text', text: 'think' }] },
        { type: 'message', role: 'assistant', content: 'with reasoning' },
        { type: 'message', role: 'assistant', content: 'without reasoning' },
      ],
    })
    const assistants = out.messages.filter((m) => m.role === 'assistant')
    expect(assistants).toHaveLength(2)
    expect(assistants[0]!.reasoning_content).toBe('think')
    // The second assistant must be backfilled so MiMo's all-or-nothing rule holds.
    expect(assistants[1]!.reasoning_content).toBe('')
  })
})
