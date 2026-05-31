import { afterEach, describe, expect, it } from 'vitest'

import {
  bindStickyAccount,
  clearStickyAccount,
  computeSessionKey,
  getStickyAccountId,
  resetStickyBindings,
} from './session'

afterEach(() => resetStickyBindings())

describe('sticky bindings', () => {
  it('returns the bound account within its TTL', () => {
    bindStickyAccount('s1', 'acc-a', 1_000)
    expect(getStickyAccountId('s1', 2_000)).toBe('acc-a')
  })

  it('expires a binding after the TTL window', () => {
    bindStickyAccount('s1', 'acc-a', 0)
    // 30 min TTL — just past it.
    expect(getStickyAccountId('s1', 30 * 60_000 + 1)).toBeNull()
  })

  it('rebinding refreshes the account and TTL', () => {
    bindStickyAccount('s1', 'acc-a', 0)
    bindStickyAccount('s1', 'acc-b', 10_000)
    expect(getStickyAccountId('s1', 20_000)).toBe('acc-b')
  })

  it('clearStickyAccount drops the binding', () => {
    bindStickyAccount('s1', 'acc-a', 0)
    clearStickyAccount('s1')
    expect(getStickyAccountId('s1', 1)).toBeNull()
  })

  it('returns null for an unknown session', () => {
    expect(getStickyAccountId('nope')).toBeNull()
  })
})

describe('computeSessionKey', () => {
  it('prefers an explicit session header', () => {
    const key = computeSessionKey('claude', 'k1', { 'x-session-id': 'conv-42' }, {})
    expect(key).toBe('claude:k1:h:conv-42')
  })

  it('is stable across turns of the same Anthropic conversation', () => {
    const turn1 = {
      system: 'You are a helpful assistant.',
      messages: [{ role: 'user', content: 'Write a function' }],
    }
    const turn2 = {
      system: 'You are a helpful assistant.',
      messages: [
        { role: 'user', content: 'Write a function' },
        { role: 'assistant', content: 'sure' },
        { role: 'user', content: 'now add error handling' },
      ],
    }
    const k1 = computeSessionKey('claude', 'k1', {}, turn1)
    const k2 = computeSessionKey('claude', 'k1', {}, turn2)
    expect(k1).not.toBeNull()
    expect(k1).toBe(k2)
  })

  it('differs across API keys for the same conversation', () => {
    const body = { messages: [{ role: 'user', content: 'hi' }] }
    expect(computeSessionKey('claude', 'k1', {}, body)).not.toBe(
      computeSessionKey('claude', 'k2', {}, body),
    )
  })

  it('differs across distinct conversations', () => {
    const a = computeSessionKey('claude', 'k1', {}, { messages: [{ role: 'user', content: 'topic A' }] })
    const b = computeSessionKey('claude', 'k1', {}, { messages: [{ role: 'user', content: 'topic B' }] })
    expect(a).not.toBe(b)
  })

  it('handles Anthropic block-array content', () => {
    const key = computeSessionKey('claude', 'k1', {}, {
      system: [{ type: 'text', text: 'sys' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    })
    expect(key).toMatch(/^claude:k1:f:/)
  })

  it('fingerprints OpenAI Responses input (string and array)', () => {
    const strKey = computeSessionKey('openai', 'k1', {}, { instructions: 'sys', input: 'hello' })
    const arrKey = computeSessionKey('openai', 'k1', {}, {
      instructions: 'sys',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
    })
    expect(strKey).toMatch(/^openai:k1:f:/)
    expect(arrKey).toMatch(/^openai:k1:f:/)
  })

  it('fingerprints Gemini contents / systemInstruction', () => {
    const key = computeSessionKey('gemini', 'k1', {}, {
      systemInstruction: { parts: [{ text: 'sys' }] },
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
    })
    expect(key).toMatch(/^gemini:k1:f:/)
  })

  it('returns null when no fingerprint can be derived', () => {
    expect(computeSessionKey('claude', 'k1', {}, {})).toBeNull()
    expect(computeSessionKey('claude', 'k1', {}, { model: 'x', stream: true })).toBeNull()
  })
})
