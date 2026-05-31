import { bigint, boolean, doublePrecision, jsonb, pgTable, text } from 'drizzle-orm/pg-core'

const epochMs = (name: string) =>
  bigint(name, { mode: 'number' })
    .notNull()
    .$defaultFn(() => Date.now())

/** One upstream subscription account (e.g. one Claude Max account). */
export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(), // claude | openai | gemini
  name: text('name').notNull(),
  oauthAccessToken: text('oauth_access_token'), // encrypted
  oauthRefreshToken: text('oauth_refresh_token'), // encrypted
  tokenExpiresAt: bigint('token_expires_at', { mode: 'number' }), // epoch ms
  status: text('status').notNull().default('active'), // active | rate_limited | error | disabled
  cooldownUntil: bigint('cooldown_until', { mode: 'number' }), // epoch ms; skip account until then
  proxyUrl: text('proxy_url'),
  weight: bigint('weight', { mode: 'number' }).notNull().default(1),
  lastUsedAt: bigint('last_used_at', { mode: 'number' }),
  metadata: jsonb('metadata'),
  createdAt: epochMs('created_at'),
})

/** A platform API key issued to a user (yourself or a friend). */
export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  ownerLabel: text('owner_label'), // friendly name of who holds the key
  keyHash: text('key_hash').notNull().unique(), // sha-256 of the secret
  keySecretEncrypted: text('key_secret_encrypted'), // encrypted plaintext secret for admin reveal/copy
  keyPrefix: text('key_prefix').notNull(), // first chars, shown in the UI
  enabled: boolean('enabled').notNull().default(true),
  allowedProviders: jsonb('allowed_providers').$type<string[]>(),
  allowedModels: jsonb('allowed_models').$type<string[]>(),
  rateLimit: bigint('rate_limit', { mode: 'number' }), // requests per minute; null = unlimited
  concurrencyLimit: bigint('concurrency_limit', { mode: 'number' }), // max simultaneous in-flight requests; null = unlimited
  quotaLimit: doublePrecision('quota_limit'), // cost cap in USD; null = unlimited
  quotaUsed: doublePrecision('quota_used').notNull().default(0),
  expiresAt: bigint('expires_at', { mode: 'number' }),
  lastUsedAt: bigint('last_used_at', { mode: 'number' }),
  createdAt: epochMs('created_at'),
})

/** One relayed request — the basis for usage and cost statistics. */
export const usageLogs = pgTable('usage_logs', {
  id: text('id').primaryKey(),
  apiKeyId: text('api_key_id'),
  accountId: text('account_id'),
  provider: text('provider').notNull(),
  model: text('model'),
  requestInput: text('request_input'),
  ts: epochMs('ts'),
  inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
  outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
  cacheCreateTokens: bigint('cache_create_tokens', { mode: 'number' }).notNull().default(0),
  cacheReadTokens: bigint('cache_read_tokens', { mode: 'number' }).notNull().default(0),
  cost: doublePrecision('cost').notNull().default(0),
  status: text('status').notNull().default('success'),
  latencyMs: bigint('latency_ms', { mode: 'number' }),
})

/** Per-model pricing used to turn token counts into cost. */
export const modelPricing = pgTable('model_pricing', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  inputPrice: doublePrecision('input_price').notNull().default(0), // USD per 1M tokens
  outputPrice: doublePrecision('output_price').notNull().default(0),
  cacheWritePrice: doublePrecision('cache_write_price').notNull().default(0),
  cacheReadPrice: doublePrecision('cache_read_price').notNull().default(0),
})

/** Transient state for an in-progress OAuth authorization. */
export const oauthSessions = pgTable('oauth_sessions', {
  state: text('state').primaryKey(),
  provider: text('provider').notNull(),
  codeVerifier: text('code_verifier').notNull(),
  // Account name supplied at /oauth/start; the callback / finish step reads it
  // back to label the new account (OpenAI uses a browser redirect, not paste).
  accountName: text('account_name'),
  createdAt: epochMs('created_at'),
})

/** Generic key/value store (admin credentials, etc.). */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})
