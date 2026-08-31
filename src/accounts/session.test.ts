import { afterEach, describe, expect, it } from 'vitest'

import {
  bindStickyAccount,
  computeSessionInfo,
  clearStickyAccount,
  computeSessionKey,
  getStickyAccountId,
  resetStickyBindings,
} from './session'

afterEach(() => resetStickyBindings())

describe('sticky bindings', () => {
  it('returns the bound account within its TTL', async () => {
    await bindStickyAccount('s1', 'acc-a', 1_000)
    expect(await getStickyAccountId('s1', 2_000)).toBe('acc-a')
  })

  it('expires a binding after the TTL window', async () => {
    await bindStickyAccount('s1', 'acc-a', 0)
    // 30 min TTL — just past it.
    expect(await getStickyAccountId('s1', 30 * 60_000 + 1)).toBeNull()
  })

  it('rebinding refreshes the account and TTL', async () => {
    await bindStickyAccount('s1', 'acc-a', 0)
    await bindStickyAccount('s1', 'acc-b', 10_000)
    expect(await getStickyAccountId('s1', 20_000)).toBe('acc-b')
  })

  it('clearStickyAccount drops the binding', async () => {
    await bindStickyAccount('s1', 'acc-a', 0)
    await clearStickyAccount('s1')
    expect(await getStickyAccountId('s1', 1)).toBeNull()
  })

  it('returns null for an unknown session', async () => {
    expect(await getStickyAccountId('nope')).toBeNull()
  })
})

describe('computeSessionKey', () => {
  it('prefers an explicit session header', () => {
    const key = computeSessionKey('claude', 'k1', { 'x-session-id': 'conv-42' }, {})
    expect(key).toBe('claude:k1:h:conv-42')
  })

  it('accepts OpenAI-style conversation_id as an explicit session header', () => {
    const info = computeSessionInfo('openai', 'k1', { conversation_id: 'conv-99' }, {})
    expect(info).toMatchObject({
      key: 'openai:k1:h:conv-99',
      source: 'header',
    })
    expect(info?.hash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('accepts the hyphenated Codex session-id header', () => {
    const info = computeSessionInfo('openai', 'k1', { 'session-id': 'codex-session-7' }, {})
    expect(info).toMatchObject({
      key: 'openai:k1:h:codex-session-7',
      source: 'header',
    })
  })

  it('prefers session-id over the legacy session_id spelling', () => {
    const key = computeSessionKey('openai', 'k1', {
      'session-id': 'current-session',
      session_id: 'legacy-session',
    }, {})
    expect(key).toBe('openai:k1:h:current-session')
  })

  it('uses prompt_cache_key when no explicit header is present', () => {
    const key = computeSessionKey('openai', 'k1', {}, {
      prompt_cache_key: 'cache-session-1',
      input: 'hello',
    })
    expect(key).toBe('openai:k1:p:cache-session-1')
  })

  it('keeps explicit headers ahead of prompt_cache_key', () => {
    const key = computeSessionKey('openai', 'k1', { session_id: 'header-session' }, {
      prompt_cache_key: 'body-session',
    })
    expect(key).toBe('openai:k1:h:header-session')
  })

  it('prefers Grok prompt_cache_key over its transient conversation header', () => {
    const key = computeSessionKey('grok', 'k1', { 'x-grok-conv-id': 'turn-summary' }, {
      prompt_cache_key: 'parent-session',
    })
    expect(key).toBe('grok:k1:p:parent-session')
  })

  it('uses a structured Grok metadata session when no prompt key is present', () => {
    const info = computeSessionInfo('grok', 'k1', { 'x-grok-conv-id': 'side-call' }, {
      metadata: { user_id: JSON.stringify({ session_id: 'parent-session' }) },
    })
    expect(info).toMatchObject({ key: 'grok:k1:m:parent-session', source: 'metadata' })
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

  it('uses OpenAI developer/system messages and the first user as a stable content anchor', () => {
    const turn1 = computeSessionKey('openai', 'k1', {}, {
      model: 'gpt-5',
      messages: [
        { role: 'developer', content: 'follow repo style' },
        { role: 'user', content: 'fix scheduler' },
      ],
      tools: [{ type: 'function', function: { name: 'search' } }],
    })
    const turn2 = computeSessionKey('openai', 'k1', {}, {
      model: 'gpt-5',
      messages: [
        { role: 'developer', content: 'follow repo style' },
        { role: 'user', content: 'fix scheduler' },
        { role: 'assistant', content: 'done' },
        { role: 'user', content: 'continue' },
      ],
      tools: [{ function: { name: 'search' }, type: 'function' }],
    })
    expect(turn1).toMatch(/^openai:k1:f:/)
    expect(turn1).toBe(turn2)
  })

  it('separates otherwise identical conversations when model or tools differ', () => {
    const base = {
      messages: [{ role: 'user', content: 'same task' }],
      tools: [{ type: 'function', function: { name: 'search' } }],
    }
    const modelA = computeSessionKey('openai', 'k1', {}, { ...base, model: 'gpt-5' })
    const modelB = computeSessionKey('openai', 'k1', {}, { ...base, model: 'gpt-5-mini' })
    const toolsB = computeSessionKey('openai', 'k1', {}, {
      ...base,
      model: 'gpt-5',
      tools: [{ type: 'function', function: { name: 'shell' } }],
    })
    expect(modelA).not.toBe(modelB)
    expect(modelA).not.toBe(toolsB)
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
