import { describe, expect, it } from 'vitest'
import {
  isPanelRateLimitedPath,
  isSensitivePanelWrite,
} from './panelRateLimit'

describe('panel rate-limit routing', () => {
  it.each([
    '/api/admin/accounts',
    '/api/auth/login',
    '/api/users/me',
    '/api/usage',
  ])('includes panel path %s', (path) => {
    expect(isPanelRateLimitedPath(path)).toBe(true)
  })

  it.each([
    '/api/openai/v1/responses',
    '/api/claude/v1/messages',
    '/v1/responses',
    '/health',
    '/user/balance',
  ])('does not double-limit relay or unrelated path %s', (path) => {
    expect(isPanelRateLimitedPath(path)).toBe(false)
  })

  it('only classifies high-risk public mutations as sensitive writes', () => {
    expect(isSensitivePanelWrite('/api/auth/register', 'POST')).toBe(true)
    expect(isSensitivePanelWrite('/api/users/invites/accept', 'POST')).toBe(true)
    expect(isSensitivePanelWrite('/api/users/redeem', 'POST')).toBe(true)
    expect(isSensitivePanelWrite('/api/admin/accounts', 'POST')).toBe(false)
    expect(isSensitivePanelWrite('/api/auth/register', 'GET')).toBe(false)
  })
})
