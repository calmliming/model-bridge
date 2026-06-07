import { appendFileSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { config as loadDotenv } from 'dotenv'
import { z } from 'zod'

const ENV_PATH = '.env'
const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value
const envBoolean = (value: unknown) => {
  const normalized = blankToUndefined(value)
  if (typeof normalized !== 'string') return normalized
  const lower = normalized.trim().toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(lower)) return true
  if (['false', '0', 'no', 'off'].includes(lower)) return false
  return normalized
}

// Load an existing .env file (if any) into process.env.
loadDotenv()

/**
 * Ensures a persistent secret exists. On first run the value is
 * generated and appended to .env so it survives restarts — critical
 * because ENCRYPTION_KEY must stay stable to decrypt stored tokens.
 */
function ensureSecret(key: string, generate: () => string): void {
  const current = process.env[key]
  if (current && current.trim() !== '') return
  const value = generate()
  process.env[key] = value
  const prefix = existsSync(ENV_PATH) ? '\n' : ''
  appendFileSync(ENV_PATH, `${prefix}${key}=${value}\n`)
  console.log(`[config] generated ${key} and saved it to ${ENV_PATH}`)
}

ensureSecret('ENCRYPTION_KEY', () => randomBytes(32).toString('hex'))
ensureSecret('JWT_SECRET', () => randomBytes(32).toString('hex'))

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z
    .string()
    .url()
    .refine((v) => v.startsWith('postgres://') || v.startsWith('postgresql://'), {
      message: 'must be a postgres:// or postgresql:// URL',
    }),
  // Legacy SQLite path. Only consumed by scripts/migrate-sqlite-to-pg.ts
  // when importing an old database — runtime no longer reads it.
  DATABASE_PATH: z.string().optional(),
  // 可选的 Redis 后端，用于跨实例共享状态（限流、并发门、粘性会话）。
  // 不配置时这些状态存在进程内存里——单节点没问题，但无法在多副本间共享。
  // 需要在负载均衡后跑多个实例时，配置这个。
  REDIS_URL: z
    .string()
    .url()
    .refine((v) => v.startsWith('redis://') || v.startsWith('rediss://'), {
      message: 'must be a redis:// or rediss:// URL',
    })
    .optional(),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters (32 bytes)'),
  JWT_SECRET: z.string().min(16, 'must be at least 16 characters'),
  ADMIN_USERNAME: z.string().min(1).default('admin'),
  ADMIN_PASSWORD: z.string().min(1).default('admin'),
  UPDATER_URL: z.preprocess(blankToUndefined, z.string().url().optional()),
  UPDATE_TOKEN: z.preprocess(blankToUndefined, z.string().min(16).optional()),
  TURNSTILE_SITE_KEY: z.preprocess(blankToUndefined, z.string().optional()),
  TURNSTILE_SECRET_KEY: z.preprocess(blankToUndefined, z.string().optional()),
  SECURITY_HEADERS_ENABLED: z.preprocess(envBoolean, z.boolean().default(true)),
  GEMINI_OAUTH_CLIENT_ID: z.string().optional(),
  GEMINI_OAUTH_CLIENT_SECRET: z.string().optional(),
  // Payment providers
  ALIPAY_APP_ID: z.string().optional(),
  ALIPAY_PRIVATE_KEY: z.string().optional(),
  ALIPAY_PUBLIC_KEY: z.string().optional(),
  ALIPAY_NOTIFY_URL: z.string().optional(),
  ALIPAY_RETURN_URL: z.string().optional(),
  WECHAT_APP_ID: z.string().optional(),
  WECHAT_MCH_ID: z.string().optional(),
  WECHAT_API_KEY: z.string().optional(),
  WECHAT_NOTIFY_URL: z.string().optional(),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('[config] invalid environment configuration:')
  for (const [field, errors] of Object.entries(parsed.error.flatten().fieldErrors)) {
    console.error(`  - ${field}: ${errors?.join(', ')}`)
  }
  process.exit(1)
}

export const config = parsed.data
export type AppConfig = typeof config
