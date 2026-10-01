import { describe, expect, it, vi } from 'vitest'

vi.mock('../db/index', () => ({ db: {}, pool: {} }))

import { openAIPlanType } from './manager'

describe('openAIPlanType', () => {
  it('reads the ChatGPT plan claim stored under metadata.openai', () => {
    expect(openAIPlanType('openai', { openai: { planType: 'pro', chatgptAccountId: 'acct' } })).toBe('pro')
    expect(openAIPlanType('openai', { openai: { planType: ' plus ' } })).toBe('plus')
  })

  it('ignores other providers, missing claims and misplaced values', () => {
    expect(openAIPlanType('claude', { openai: { planType: 'pro' } })).toBeNull()
    expect(openAIPlanType('openai', { planType: 'pro' })).toBeNull()
    expect(openAIPlanType('openai', { openai: { planType: '' } })).toBeNull()
    expect(openAIPlanType('openai', null)).toBeNull()
  })
})
