import { describe, expect, it } from 'vitest'

import { normalizeClaudeMessagesBody } from './relay'

describe('normalizeClaudeMessagesBody', () => {
  it('removes client-only context management fields rejected by Anthropic', () => {
    const body = normalizeClaudeMessagesBody({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      context_management: { clear_function_results: true },
      messages: [{ role: 'user', content: 'hello' }],
    })

    expect(body).not.toHaveProperty('context_management')
    expect(body.model).toBe('claude-sonnet-4-5')
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }])
  })
})
