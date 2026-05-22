import { sql } from 'drizzle-orm'
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

const createdAt = () =>
  integer('created_at')
    .notNull()
    .default(sql`(unixepoch() * 1000)`)

/** One upstream subscription account (e.g. one Claude Max account). */
export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(), // claude | openai | gemini
  name: text('name').notNull(),
  oauthAccessToken: text('oauth_access_token'), // encrypted
  oauthRefreshToken: text('oauth_refresh_token'), // encrypted
  tokenExpiresAt: integer('token_expires_at'), // epoch ms
  status: text('status').notNull().default('active'), // active | rate_limited | error | disabled
  cooldownUntil: integer('cooldown_until'), // epoch ms; skip account until then
  proxyUrl: text('proxy_url'),
  weight: integer('weight').notNull().default(1),
  lastUsedAt: integer('last_used_at'),
  metadata: text('metadata', { mode: 'json' }),
  createdAt: createdAt(),
})

/** A platform API key issued to a user (yourself or a friend). */
export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  ownerLabel: text('owner_label'), // friendly name of who holds the key
  keyHash: text('key_hash').notNull().unique(), // sha-256 of the secret
  keyPrefix: text('key_prefix').notNull(), // first chars, shown in the UI
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  allowedProviders: text('allowed_providers', { mode: 'json' }).$type<string[]>(),
  allowedModels: text('allowed_models', { mode: 'json' }).$type<string[]>(),
  rateLimit: integer('rate_limit'), // requests per minute; null = unlimited
  quotaLimit: real('quota_limit'), // cost cap in USD; null = unlimited
  quotaUsed: real('quota_used').notNull().default(0),
  expiresAt: integer('expires_at'),
  lastUsedAt: integer('last_used_at'),
  createdAt: createdAt(),
})

/** One relayed request — the basis for usage and cost statistics. */
export const usageLogs = sqliteTable('usage_logs', {
  id: text('id').primaryKey(),
  apiKeyId: text('api_key_id'),
  accountId: text('account_id'),
  provider: text('provider').notNull(),
  model: text('model'),
  ts: integer('ts')
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheCreateTokens: integer('cache_create_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  cost: real('cost').notNull().default(0),
  status: text('status').notNull().default('success'),
  latencyMs: integer('latency_ms'),
})

/** Per-model pricing used to turn token counts into cost. */
export const modelPricing = sqliteTable('model_pricing', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  inputPrice: real('input_price').notNull().default(0), // USD per 1M tokens
  outputPrice: real('output_price').notNull().default(0),
  cacheWritePrice: real('cache_write_price').notNull().default(0),
  cacheReadPrice: real('cache_read_price').notNull().default(0),
})

/** Transient state for an in-progress OAuth authorization. */
export const oauthSessions = sqliteTable('oauth_sessions', {
  state: text('state').primaryKey(),
  provider: text('provider').notNull(),
  codeVerifier: text('code_verifier').notNull(),
  createdAt: createdAt(),
})

/** Generic key/value store (admin credentials, etc.). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})
