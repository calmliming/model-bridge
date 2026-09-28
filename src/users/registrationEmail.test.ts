import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../config', () => ({ config: { RESEND_API_KEY: 're_test_key', RESEND_FROM_EMAIL: 'noreply@example.com' } }))
import { emailRegistrationConfigured, sendRegistrationCode } from './registrationEmail'

afterEach(() => vi.unstubAllGlobals())

describe('Resend registration email', () => {
  it('sends the code with the configured sender and a unique idempotency key', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'email-id' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(emailRegistrationConfigured()).toBe(true)
    await sendRegistrationCode('user@example.com', '001234', 'registration-id')
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect(options.headers).toMatchObject({ Authorization: 'Bearer re_test_key', 'Idempotency-Key': 'registration/registration-id' })
    expect(JSON.parse(options.body as string)).toMatchObject({
      from: 'Model Bridge <noreply@example.com>', to: ['user@example.com'], subject: 'Model Bridge 邮箱注册验证码',
    })
    expect((options.body as string)).toContain('001234')
  })

  it('rejects a failed provider response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })))
    await expect(sendRegistrationCode('user@example.com', '001234', 'id')).rejects.toThrow('email delivery failed')
  })

  it('does not accept a success response without an email id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    await expect(sendRegistrationCode('user@example.com', '001234', 'id')).rejects.toThrow('email delivery failed')
  })
})
