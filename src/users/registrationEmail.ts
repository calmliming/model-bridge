import { config } from '../config'

const RESEND_EMAILS_URL = 'https://api.resend.com/emails'

export function emailRegistrationConfigured(): boolean {
  return !!(config.RESEND_API_KEY && config.RESEND_FROM_EMAIL)
}

export async function sendRegistrationCode(email: string, code: string, id: string): Promise<void> {
  if (!emailRegistrationConfigured()) throw new Error('email registration is not configured')

  let response: Response
  try {
    response = await fetch(RESEND_EMAILS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `registration/${id}`,
      },
      body: JSON.stringify({
        from: `Model Bridge <${config.RESEND_FROM_EMAIL}>`,
        to: [email],
        subject: 'Model Bridge 邮箱注册验证码',
        text: `你的注册验证码是 ${code}，10 分钟内有效。若非本人操作，请忽略此邮件。`,
        html: `<p>你的 Model Bridge 注册验证码是：</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>10 分钟内有效。若非本人操作，请忽略此邮件。</p>`,
      }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    console.warn('[registration-email] Resend request failed:', error instanceof Error ? error.name : 'unknown')
    throw new Error('email delivery failed')
  }
  if (!response.ok) {
    console.warn(`[registration-email] Resend rejected email: HTTP ${response.status}`)
    throw new Error('email delivery failed')
  }
  const result = await response.json().catch(() => null) as { id?: unknown } | null
  if (typeof result?.id !== 'string' || !result.id) throw new Error('email delivery failed')
}
