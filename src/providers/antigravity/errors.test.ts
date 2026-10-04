import { describe, expect, it } from 'vitest'
import { antigravityClientError, sanitizeAntigravityErrorText, sanitizeAntigravityResponse } from './errors'

describe('Antigravity client error sanitization', () => {
  it('redacts account identities and credentials while keeping useful error text', () => {
    const text = sanitizeAntigravityErrorText('Permission denied for projects/private-project-42; '
      + 'pool-bot@private-project-42.iam.gserviceaccount.com; consumer: 123456789012; '
      + 'project id private-project-42; project number=987654321012; '
      + "project 'private-project-42'; "
      + 'https://internal.example/v1?key=secret; Bearer private-token; sk-privatekey12345')
    expect(text).toContain('Permission denied')
    for (const privateValue of ['private-project-42', 'gserviceaccount.com', '123456789012', '987654321012',
      'internal.example', 'private-token', 'sk-privatekey12345']) expect(text).not.toContain(privateValue)
  })

  it('drops untrusted metadata while retaining the Google error code and billing counts', () => {
    const payload = { response: { error: { code: 403, status: 'PERMISSION_DENIED',
      message: 'Denied for projects/private-project-42', details: [{ metadata: { secret: 'private-value' } }] },
    project: 'private-project-42', usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 5,
      cachedContentTokenCount: 20, thoughtsTokenCount: 3, totalTokenCount: 108, project: 'private-project-42' } } }
    expect(sanitizeAntigravityResponse(payload)).toEqual({
      error: { code: 403, status: 'PERMISSION_DENIED', message: 'Denied for projects/[redacted]' },
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 5,
        cachedContentTokenCount: 20, thoughtsTokenCount: 3, totalTokenCount: 108 },
    })
    expect(payload.response.error.details).toHaveLength(1)
  })

  it('creates valid errors from text, string errors, and malformed error fields', () => {
    expect(antigravityClientError('Quota exceeded for consumer 123456789012', 429)).toEqual({
      error: { code: 429, message: 'Quota exceeded for consumer [redacted-project]' },
    })
    expect(sanitizeAntigravityResponse({ error: 'Denied for projects/private-project-42' })).toEqual({
      error: { code: 502, message: 'Denied for projects/[redacted]' },
    })
    expect(antigravityClientError({ error: { code: 123456789012, status: 'private-project-42' } }, 403)).toEqual({
      error: { code: 403, message: 'Antigravity upstream returned HTTP 403.' },
    })
  })

  it('preserves successful generated content, signatures, tools, and usage', () => {
    const response = { candidates: [{ content: { parts: [{ text: 'Contact user@example.com about projects/public-docs',
      thoughtSignature: 'signature', functionCall: { name: 'lookup', args: { project: 'public-docs' } } }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2 } }
    expect(sanitizeAntigravityResponse({ response })).toBe(response)
  })
})
