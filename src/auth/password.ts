import { z } from 'zod'

export const ADMIN_PASSWORD_REQUIREMENT = '密码必须为 8–72 个 UTF-8 字节，且不能全为空白'
export const USER_PASSWORD_REQUIREMENT = '密码至少为 6 个字符，且不能超过 72 个 UTF-8 字节'

// Only apply this when setting a password. Existing hashes must remain usable
// at login, including passwords accepted before the byte limit was enforced.
export const userPasswordSchema = z.string().min(6, USER_PASSWORD_REQUIREMENT).refine(
  value => Buffer.byteLength(value, 'utf8') <= 72,
  USER_PASSWORD_REQUIREMENT,
)

// bcrypt silently truncates passwords beyond 72 bytes, including multibyte text.
export const adminPasswordSchema = z.string().refine(value => {
  const bytes = Buffer.byteLength(value, 'utf8')
  return bytes >= 8 && bytes <= 72 && value.trim().length > 0
}, ADMIN_PASSWORD_REQUIREMENT)
