import { describe, expect, it } from 'vitest'
import { extractOpenAIIdentity } from './identity'

/** Builds an unsigned JWT with the given payload (header.payload.signature). */
function makeJwt(payload: Record<string, unknown>): string {
  const enc = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc(payload)}.sig`
}

describe('extractOpenAIIdentity', () => {
  it('pulls ChatGPT identity from the namespaced auth claim', () => {
    const token = makeJwt({
      email: 'dev@example.com',
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct-123',
        chatgpt_user_id: 'user-456',
        chatgpt_plan_type: 'pro',
        poid: 'org-789',
      },
    })
    expect(extractOpenAIIdentity(token)).toEqual({
      chatgptAccountId: 'acct-123',
      chatgptUserId: 'user-456',
      organizationId: 'org-789',
      email: 'dev@example.com',
      planType: 'pro',
    })
  })

  it('falls back to user_id and the default organization entry', () => {
    const token = makeJwt({
      'https://api.openai.com/auth': {
        user_id: 'user-fallback',
        organizations: [
          { id: 'org-a', is_default: false },
          { id: 'org-b', is_default: true },
        ],
      },
    })
    const identity = extractOpenAIIdentity(token)
    expect(identity.chatgptUserId).toBe('user-fallback')
    expect(identity.organizationId).toBe('org-b')
  })

  it('uses the first organization when none is marked default', () => {
    const token = makeJwt({
      'https://api.openai.com/auth': { organizations: [{ id: 'org-first' }, { id: 'org-second' }] },
    })
    expect(extractOpenAIIdentity(token).organizationId).toBe('org-first')
  })

  it('returns an empty object for a missing or malformed token', () => {
    expect(extractOpenAIIdentity(undefined)).toEqual({})
    expect(extractOpenAIIdentity('')).toEqual({})
    expect(extractOpenAIIdentity('not-a-jwt')).toEqual({})
    expect(extractOpenAIIdentity('a.b')).toEqual({}) // payload "b" isn't valid base64url JSON
  })

  it('omits fields that are absent from the claims', () => {
    const token = makeJwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-only' } })
    expect(extractOpenAIIdentity(token)).toEqual({ chatgptAccountId: 'acct-only' })
  })
})
