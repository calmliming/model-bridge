import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { parse as parseDotenv } from 'dotenv'
import { z } from 'zod'

/**
 * 本地开发与线上生产的环境文件是分开的，避免"本地一跑就写生产库"。
 *
 *   本地：.env.local  （被 .gitignore 的 `*.local` 忽略，永不进版本库）
 *   线上：.env        （docker-compose.yml 通过 environment 注入，文件仅在服务器上）
 *
 * 关键设计：模式判定的依据是"仓库根目录是否存在 .env.local"，而不是某个
 * 环境变量。早期版本用 APP_ENV=local 做开关，结果任何继承来的同名环境变量
 * （父进程、CI、容器 environment）都能把它盖掉，导致本地进程静默连上生产库——
 * 这正是本机制要防的事故。改看文件后，开关只由开发者自己放在磁盘上的文件决定。
 *
 * 容器内 NODE_ENV=production（见 Dockerfile），且 .dockerignore 排除了
 * `.env.*`，所以线上永远走不到 .env.local 分支。
 */
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

/** 本地模式：存在 .env.local，且不是在容器里跑（NODE_ENV=production）。 */
const LOCAL_ENV_PATH = '.env.local'
const isLocalDevelopment =
  process.env.NODE_ENV !== 'production' && existsSync(LOCAL_ENV_PATH)

/** 当前实例实际使用的环境文件，供启动日志与自动生成密钥时写回。 */
export const ENV_PATH = isLocalDevelopment ? LOCAL_ENV_PATH : '.env'

/** 运行模式，供启动横幅与远端库保护使用。 */
export const APP_ENV: 'local' | 'production' = isLocalDevelopment ? 'local' : 'production'

/**
 * 读入环境文件。这里刻意自己解析而不用 dotenv 的 override：
 * dotenv 默认"已存在的环境变量优先"，在本地模式下会让继承来的
 * DATABASE_URL / PORT 等盖掉 .env.local，等于隔离失效。
 * 本地模式下 .env.local 必须是权威来源，因此显式写入覆盖。
 */
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return
  const parsed = parseDotenv(readFileSync(path, 'utf8'))
  for (const [key, value] of Object.entries(parsed)) {
    process.env[key] = value
  }
}

// 测试环境不加载任何 env 文件：vitest 在 vitest.config.ts 里注入了专用的
// 假凭据（DATABASE_URL 指向端口 1，fail-closed）。若在这里覆盖，测试会
// 打到真实数据库上。
const isTestEnvironment = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'
if (!isTestEnvironment) loadEnvFile(ENV_PATH)

if (isLocalDevelopment && blankToUndefined(process.env.APP_ENV) !== 'local') {
  // 不是错误，只是提醒：模式由 .env.local 决定，环境变量说了不算。
  console.warn(`[config] 本地模式（已加载 ${ENV_PATH}）；环境变量 APP_ENV=${process.env.APP_ENV ?? '(未设置)'} 已被忽略`)
}

/**
 * Ensures a persistent secret exists. On first run the value is
 * generated and appended to the active env file so it survives restarts —
 * critical because ENCRYPTION_KEY must stay stable to decrypt stored tokens.
 * 本地写入 .env.local，线上写入 .env，两者不会互相污染。
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

/**
 * 出站 HTTP(S)/SOCKS5 代理 URL 校验，供各处的代理配置共用。
 * 只允许纯代理地址：不能带路径、查询串或片段，避免被当成业务 URL 使用。
 */
const proxyUrlSchema = z.string().url().refine(value => {
  const url = new URL(value)
  return ['http:', 'https:', 'socks5:'].includes(url.protocol)
    && (!url.pathname || url.pathname === '/') && !url.search && !url.hash
}, 'must be an HTTP(S) or SOCKS5 proxy URL without a path/query/fragment')

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
  REDIS_URL: z.preprocess(
    blankToUndefined,
    z.string().url().refine((v) => v.startsWith('redis://') || v.startsWith('rediss://'), {
      message: 'must be a redis:// or rediss:// URL',
    }).optional(),
  ),
  // AES-256 key for encrypting OAuth tokens at rest — 64 hex chars.
  // 本地与线上必须使用各自独立的密钥：本地库即使被清空/泄露，
  // 也解不开生产库里的任何密文。
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters (32 bytes)'),
  JWT_SECRET: z.string().min(16, 'must be at least 16 characters'),
  // 本地开发误连远端库时的显式闸门。见 src/db/index.ts：
  // 本地模式下 DATABASE_URL 指向非回环主机会直接拒绝启动，
  // 必须显式设为 true 才能放行（用于"确实要本地连远端库"的少数场景）。
  ALLOW_REMOTE_DB: z.preprocess(envBoolean, z.boolean().default(false)),
  ADMIN_USERNAME: z.string().min(1).default('admin'),
  ADMIN_PASSWORD: z.string().min(1).default('admin'),
  CLAUDE_CLI_VERSION: z.preprocess(blankToUndefined, z.string().max(30).regex(/^\d+\.\d+\.\d+$/)
    .refine((value) => {
      const [major, minor, patch] = value.split('.').map(Number)
      return major! > 2 || (major === 2 && (minor! > 1 || (minor === 1 && patch! >= 251)))
    }, 'must be 2.1.251 or newer for Fable 5.1 compatibility').default('2.1.263')),
  PRICING_OVERRIDE_FILE: z.preprocess(blankToUndefined, z.string().optional()),
  UPDATER_URL: z.preprocess(blankToUndefined, z.string().url().optional()),
  UPDATE_TOKEN: z.preprocess(blankToUndefined, z.string().min(16).optional()),
  TURNSTILE_SITE_KEY: z.preprocess(blankToUndefined, z.string().optional()),
  TURNSTILE_SECRET_KEY: z.preprocess(blankToUndefined, z.string().optional()),
  // Website sign-in client, separate from upstream Gemini/Antigravity OAuth.
  GOOGLE_LOGIN_CLIENT_ID: z.preprocess(blankToUndefined, z.string().trim()
    .regex(/^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/, 'must be a Google Web OAuth client ID').optional()),
  SECURITY_HEADERS_ENABLED: z.preprocess(envBoolean, z.boolean().default(true)),
  PANEL_AUTHENTICATED_RATE_LIMIT: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().positive().default(300),
  ),
  PANEL_PUBLIC_RATE_LIMIT: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().positive().default(60),
  ),
  PANEL_WRITE_RATE_LIMIT: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().positive().default(10),
  ),
  // IANA timezone used to compute "today" boundaries for dashboard stats.
  // Defaults to Asia/Shanghai so daily figures match Beijing time regardless of
  // where the server runs. Unlike some gateways we don't crash on a bad value —
  // an unrecognized zone falls back to UTC with a warning.
  STATS_TIMEZONE: z.preprocess(blankToUndefined, z.string().optional()).transform((tz) => {
    const wanted = tz ?? 'Asia/Shanghai'
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: wanted })
      return wanted
    } catch {
      console.warn(`[config] invalid STATS_TIMEZONE "${wanted}", falling back to UTC`)
      return 'UTC'
    }
  }),
  // When a sticky session is already bound to an account but that account's
  // concurrency slot is full, wait briefly before falling back to another
  // account. Set to 0 to keep the old immediate-fallback behavior.
  STICKY_SESSION_WAIT_MS: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(0).max(120_000).default(15_000),
  ),
  // Enables the OpenAI Images API bridge and preserves explicitly requested
  // image_generation tools on the Responses endpoint. Disable this when the
  // configured ChatGPT OAuth accounts do not have image-generation access.
  OPENAI_IMAGE_GENERATION_ENABLED: z.preprocess(envBoolean, z.boolean().default(true)),
  // When an OAuth account explicitly reports that image_generation is
  // unavailable, cool only that account's image capability for this long.
  // Text requests on the same account remain schedulable.
  OPENAI_IMAGE_UNAVAILABLE_COOLDOWN_MINUTES: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(120).default(30),
  ),
  GEMINI_OAUTH_CLIENT_ID: z.string().optional(),
  GEMINI_OAUTH_CLIENT_SECRET: z.string().optional(),
  ANTIGRAVITY_OAUTH_CLIENT_ID: z.preprocess(blankToUndefined, z.string().default('1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com')),
  ANTIGRAVITY_OAUTH_CLIENT_SECRET: z.preprocess(blankToUndefined, z.string().optional()),
  ANTIGRAVITY_USER_AGENT_VERSION: z.preprocess(blankToUndefined, z.string().regex(/^\d+\.\d+\.\d+$/).default('2.12.2')),
  ANTIGRAVITY_API_HOST: z.preprocess(blankToUndefined, z.enum(['cloudcode-pa.googleapis.com', 'daily-cloudcode-pa.googleapis.com']).default('daily-cloudcode-pa.googleapis.com')),
  ANTIGRAVITY_PROXY_URL: z.preprocess(blankToUndefined, proxyUrlSchema.optional()),
  /**
   * 普通上游（relay、目录同步、余额查询）的出站代理。
   *
   * 为什么需要独立一项：容器/服务端的 Node 进程不使用系统代理，
   * 在只能经代理出网的环境里，所有上游请求都会直接超时。
   * 留空则走直连（默认）。也可以用标准的 HTTPS_PROXY/HTTP_PROXY
   * 环境变量，两者等价——参见 src/http/upstream.ts 的解析顺序。
   */
  UPSTREAM_PROXY_URL: z.preprocess(blankToUndefined, z.string().url().refine(value => {
    const url = new URL(value)
    return ['http:', 'https:', 'socks5:'].includes(url.protocol)
      && (!url.pathname || url.pathname === '/') && !url.search && !url.hash
  }, 'must be an HTTP(S) or SOCKS5 proxy URL without a path/query/fragment').optional()),
  // Payment providers
  ALIPAY_ENV: z.enum(['production', 'sandbox']).default('production'),
  ALIPAY_APP_ID: z.string().optional(),
  ALIPAY_PRIVATE_KEY: z.string().optional(),
  ALIPAY_PUBLIC_KEY: z.string().optional(),
  ALIPAY_GATEWAY: z.preprocess(blankToUndefined, z.string().url().optional()),
  ALIPAY_NOTIFY_URL: z.preprocess(blankToUndefined, z.string().url().optional()),
  ALIPAY_RETURN_URL: z.preprocess(blankToUndefined, z.string().url().optional()),
  ALIPAY_SELLER_ID: z.preprocess(blankToUndefined, z.string().optional()),
  ALIPAY_SELLER_EMAIL: z.preprocess(blankToUndefined, z.string().email().optional()),
  ALIPAY_USD_CNY_RATE: z.preprocess(
    blankToUndefined,
    z.string().regex(/^\d+(?:\.\d{1,4})?$/).default('7.20'),
  ),
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
