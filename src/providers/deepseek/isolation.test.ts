import { describe, expect, it } from 'vitest'
import { deepseekIsolationId, withDeepseekUserIsolation } from './isolation'

describe('DeepSeek user isolation', () => {
  it('is stable, opaque, and valid for the upstream constraint', () => {
    const first = deepseekIsolationId('key_1', 'user_1', 'end-user-a')
    expect(first).toBe(deepseekIsolationId('key_1', 'user_1', 'end-user-a'))
    expect(first).toMatch(/^mb_[A-Za-z0-9_-]{48}$/)
    expect(first).not.toContain('end-user-a')
    expect(first).not.toBe(deepseekIsolationId('key_1', 'user_1', 'end-user-b'))
  })

  it('writes user_id in Anthropic metadata without dropping other fields', () => {
    const out = withDeepseekUserIsolation(
      { metadata: { trace: 'x', user_id: 'client-user' }, input: 'hi' },
      'messages',
      'key_1',
      'owner_1',
    )
    expect(out.metadata).toMatchObject({ trace: 'x' })
    expect((out.metadata as Record<string, unknown>).user_id).toMatch(/^mb_/)
  })

  it('uses dialect-specific top-level fields for Chat and Responses', () => {
    const chat = withDeepseekUserIsolation({ user_id: 'end-user', model: 'x' }, 'chat.completions', 'k', null)
    const responses = withDeepseekUserIsolation({ user: 'end-user', model: 'x' }, 'responses', 'k', null)
    expect(chat.user_id).toMatch(/^mb_/)
    expect(responses.user).toMatch(/^mb_/)
  })
})
