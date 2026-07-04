import { describe, expect, it } from 'vitest'
import {
  matchPermanentRefreshSignal,
  PermanentRefreshError,
  reauthStateFromMetadata,
  refreshFailureStatus,
} from './refreshErrors'

/** Mimics the provider's thrown error shape: `token refresh failed (${status}): ${body}`. */
function refreshError(status: number, body: string): Error {
  return new Error(`token refresh failed (${status}): ${body}`)
}

describe('matchPermanentRefreshSignal', () => {
  it('flags each permanent signal from an upstream error body', () => {
    const cases: Array<[string, string]> = [
      ['invalid_grant', '{"error":"invalid_grant"}'],
      ['invalid_refresh_token', '{"error":"invalid_refresh_token"}'],
      ['token_expired', '{"error":{"code":"token_expired"}}'],
      ['refresh_token_invalidated', '{"error":"refresh_token_invalidated"}'],
      ['refresh_token_reused', '{"error":"refresh_token_reused"}'],
      ['app_session_terminated', '{"error":"app_session_terminated"}'],
      ['invalid_client', '{"error":"invalid_client"}'],
      ['unauthorized_client', '{"error":"unauthorized_client"}'],
      ['access_denied', '{"error":"access_denied"}'],
    ]
    for (const [signal, body] of cases) {
      expect(matchPermanentRefreshSignal(refreshError(400, body))).toBe(signal)
    }
  })

  it('matches case-insensitively', () => {
    expect(matchPermanentRefreshSignal(new Error('Error: INVALID_GRANT'))).toBe('invalid_grant')
  })

  it('flags a locally-missing refresh token', () => {
    expect(matchPermanentRefreshSignal(new Error('account has no refresh token'))).toBe(
      'account has no refresh token',
    )
  })

  it('treats transient failures as retryable (fail-safe → null)', () => {
    expect(matchPermanentRefreshSignal(refreshError(429, 'rate limited'))).toBeNull()
    expect(matchPermanentRefreshSignal(refreshError(500, 'internal error'))).toBeNull()
    expect(matchPermanentRefreshSignal(refreshError(503, 'service unavailable'))).toBeNull()
    expect(matchPermanentRefreshSignal(new Error('AbortError: timed out'))).toBeNull()
    expect(matchPermanentRefreshSignal(new Error('fetch failed'))).toBeNull()
    expect(matchPermanentRefreshSignal(new Error('something unexpected'))).toBeNull()
  })

  it('accepts non-Error values without throwing', () => {
    expect(matchPermanentRefreshSignal('invalid_grant somewhere')).toBe('invalid_grant')
    expect(matchPermanentRefreshSignal(undefined)).toBeNull()
  })
})

describe('refreshFailureStatus', () => {
  it('parses the HTTP status out of the provider error message', () => {
    expect(refreshFailureStatus(refreshError(429, 'x'))).toBe(429)
    expect(refreshFailureStatus(refreshError(503, 'x'))).toBe(503)
  })

  it('returns undefined when no status is present', () => {
    expect(refreshFailureStatus(new Error('fetch failed'))).toBeUndefined()
  })
})

describe('PermanentRefreshError', () => {
  it('carries the account id, signal, and optional status', () => {
    const err = new PermanentRefreshError('acct-1', 'invalid_grant', 400)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('PermanentRefreshError')
    expect(err.accountId).toBe('acct-1')
    expect(err.signal).toBe('invalid_grant')
    expect(err.status).toBe(400)
  })
})

describe('reauthStateFromMetadata', () => {
  it('reads a valid reauth marker', () => {
    const state = reauthStateFromMetadata({
      reauth: { required: true, reason: 'invalid_grant', provider: 'openai', at: 123 },
    })
    expect(state).toEqual({ required: true, reason: 'invalid_grant', provider: 'openai', at: 123 })
  })

  it('returns null when the marker is absent or not required', () => {
    expect(reauthStateFromMetadata(null)).toBeNull()
    expect(reauthStateFromMetadata({})).toBeNull()
    expect(reauthStateFromMetadata({ reauth: { required: false } })).toBeNull()
    expect(reauthStateFromMetadata('not an object')).toBeNull()
  })
})
