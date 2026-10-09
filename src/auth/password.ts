import { z } from 'zod'

export const ADMIN_PASSWORD_REQUIREMENT = '密码必须为 8–72 个 UTF-8 字节，且不能全为空白'

// bcrypt silently truncates passwords beyond 72 bytes, including multibyte text.
export const adminPasswordSchema = z.string().refine(value => {
  const bytes = Buffer.byteLength(value, 'utf8')
  return bytes >= 8 && bytes <= 72 && value.trim().length > 0
}, ADMIN_PASSWORD_REQUIREMENT)
