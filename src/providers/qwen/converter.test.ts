import { describe, expect, it } from 'vitest'
import { mapModel, responsesToChatCompletions } from './converter'

describe('qwen mapModel', () => {
  it('passes through qwen* model names', () => {
    expect(mapModel('qwen3.8-max')).toBe('qwen3.8-max')
    expect(mapModel('qwen3.7-plus')).toBe('qwen3.7-plus')
    expect(mapModel('qwen3.7-flash')).toBe('qwen3.7-flash')
  })

  it('rewrites unknown / Codex model names to the current flagship', () => {
    expect(mapModel('gpt-5.5')).toBe('qwen3.8-max')
    expect(mapModel('')).toBe('qwen3.8-max')
    expect(mapModel(undefined)).toBe('qwen3.8-max')
  })
})

describe('qwen responsesToChatCompletions', () => {
  it('maps instructions + string input into system/user messages', () => {
    const out = responsesToChatCompletions({
      model: 'qwen3.7-plus',
      instructions: 'be terse',
      input: 'hello',
      stream: true,
    })
    expect(out.model).toBe('qwen3.7-plus')
    expect(out.stream).toBe(true)
    expect(out.messages).toEqual([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hello' },
    ])
  })

  it('enforces uniform reasoning_content across assistant messages', () => {
    const out = responsesToChatCompletions({
      model: 'qwen3.8-max',
      input: [
        { type: 'reasoning', summary: [{ type: 'summary_text', text: 'think' }] },
        { type: 'message', role: 'assistant', content: 'with reasoning' },
        { type: 'message', role: 'assistant', content: 'without reasoning' },
      ],
    })
    const assistants = out.messages.filter((m) => m.role === 'assistant')
    expect(assistants).toHaveLength(2)
    expect(assistants[0]!.reasoning_content).toBe('think')
    // The second assistant must be backfilled so Qwen's all-or-nothing rule holds.
    expect(assistants[1]!.reasoning_content).toBe('')
  })
})
