import { describe, expect, it } from 'vitest'
import { mapModel, responsesToChatCompletions } from './converter'

describe('zhipu mapModel', () => {
  it('passes through glm-* model names', () => {
    expect(mapModel('glm-5.3')).toBe('glm-5.3')
    expect(mapModel('glm-5.3-flash')).toBe('glm-5.3-flash')
    expect(mapModel('glm-5.2')).toBe('glm-5.2')
  })

  it('rewrites unknown / Codex model names to the flagship', () => {
    expect(mapModel('gpt-5.5')).toBe('glm-5.3')
    expect(mapModel('')).toBe('glm-5.3')
    expect(mapModel(undefined)).toBe('glm-5.3')
  })
})

describe('zhipu responsesToChatCompletions', () => {
  it('maps instructions + string input into system/user messages', () => {
    const out = responsesToChatCompletions({
      model: 'glm-5.3-flash',
      instructions: 'be terse',
      input: 'hello',
      stream: true,
    })
    expect(out.model).toBe('glm-5.3-flash')
    expect(out.stream).toBe(true)
    expect(out.messages).toEqual([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hello' },
    ])
  })

  it('enforces uniform reasoning_content across assistant messages', () => {
    const out = responsesToChatCompletions({
      model: 'glm-5.3',
      input: [
        { type: 'reasoning', summary: [{ type: 'summary_text', text: 'think' }] },
        { type: 'message', role: 'assistant', content: 'with reasoning' },
        { type: 'message', role: 'assistant', content: 'without reasoning' },
      ],
    })
    const assistants = out.messages.filter((m) => m.role === 'assistant')
    expect(assistants).toHaveLength(2)
    expect(assistants[0]!.reasoning_content).toBe('think')
    // The second assistant must be backfilled so GLM's all-or-nothing rule holds.
    expect(assistants[1]!.reasoning_content).toBe('')
  })
})
