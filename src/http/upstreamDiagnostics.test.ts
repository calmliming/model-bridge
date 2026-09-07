import { describe, expect, it } from 'vitest'
import { isRequestIdHeader, upstreamRequestId, streamFailureDetails } from './upstreamDiagnostics'

describe('upstream diagnostics', () => {
  it('uses a custom request id header before provider defaults', () => {
    expect(upstreamRequestId(new Headers({ 'trace-id': 'trace-1', 'x-request-id': 'request-1' }), 'trace-id')).toBe('trace-1')
    expect(upstreamRequestId(new Headers({ 'x-request-id': 'request-1' }))).toBe('request-1')
  })
  it('rejects unsafe custom header names and unbounded IDs', () => {
    expect(isRequestIdHeader('set-cookie')).toBe(false)
    expect(isRequestIdHeader('authorization')).toBe(false)
    expect(isRequestIdHeader('x-id\r\n')).toBe(false)
    expect(upstreamRequestId(new Headers({ 'x-request-id': 'x'.repeat(201) }))).toBeNull()
  })
  it('retains useful failure details while redacting credentials and URLs', () => {
    expect(streamFailureDetails({ type: 'response.failed', response: { error: {
      code: 'server_error', message: 'failed at https://private.example/path Bearer abcdef sk-1234567890',
    } } })).toEqual({ code: 'server_error', message: 'failed at [redacted-url] Bearer [redacted] [redacted-key]' })
  })
  it('recognizes top-level errors and incomplete reasons', () => {
    expect(streamFailureDetails({ type: 'error', error: { type: 'overloaded_error', message: 'busy' } }))
      .toEqual({ code: 'overloaded_error', message: 'busy' })
    expect(streamFailureDetails({ type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } }))
      .toMatchObject({ code: 'max_output_tokens' })
  })
})
