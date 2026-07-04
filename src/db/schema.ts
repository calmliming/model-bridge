import { bigint, boolean, doublePrecision, jsonb, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'

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
  concurrencyLimit: bigint('concurrency_limit', { mode: 'number' }), // max simultaneous in-flight requests; null = unlimited
  lastUsedAt: bigint('last_used_at', { mode: 'number' }),
  groupId: text('group_id'), // null = 默认池（未分组）；非空时仅绑定该组的 Key 可调度
  notes: text('notes'),
  metadata: jsonb('metadata'),
  createdAt: epochMs('created_at'),
})

/** A named pool of upstream accounts. Keys bound to a group only schedule within it. */
export const accountGroups = pgTable('account_groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  // Billing markup applied to usage charged through this group. 1.0 = list
  // price; <1 discounts, >1 marks up. Keys bound to the group bill at this rate.
  rateMultiplier: doublePrecision('rate_multiplier').notNull().default(1),
  createdAt: epochMs('created_at'),
})

/**
 * Many-to-many membership: which accounts serve which groups. An account may
 * belong to several groups; `weight` overrides accounts.weight within this
 * group (null = inherit). The default pool is the set of accounts with no
 * membership row at all.
 */
export const accountGroupMembers = pgTable(
  'account_group_members',
  {
    accountId: text('account_id').notNull(),
    groupId: text('group_id').notNull(),
    weight: bigint('weight', { mode: 'number' }), // null = inherit accounts.weight
    createdAt: epochMs('created_at'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.accountId, t.groupId] }),
  }),
)

/**
 * A purchasable subscription plan. Bound to one account group; grants rolling
 * daily/weekly/monthly USD spend windows (null = that window is unlimited).
 */
export const subscriptionPlans = pgTable('subscription_plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  groupId: text('group_id').notNull(), // the account group this subscription grants
  price: doublePrecision('price').notNull().default(0), // wallet purchase price (USD)
  dailyLimitUsd: doublePrecision('daily_limit_usd'), // null = unlimited
  weeklyLimitUsd: doublePrecision('weekly_limit_usd'),
  monthlyLimitUsd: doublePrecision('monthly_limit_usd'),
  validityDays: bigint('validity_days', { mode: 'number' }).notNull().default(30),
  forSale: boolean('for_sale').notNull().default(false), // listed in the user-facing store
  sortOrder: bigint('sort_order', { mode: 'number' }).notNull().default(0),
  createdAt: epochMs('created_at'),
})

/**
 * One user's active (or expired) subscription to a plan. Tracks rolling usage
 * windows charged at sale price. At most one active row per (user, group).
 */
export const userSubscriptions = pgTable('user_subscriptions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  planId: text('plan_id').notNull(),
  groupId: text('group_id').notNull(), // denormalized from the plan for fast scheduling lookups
  status: text('status').notNull().default('active'), // active | expired
  startsAt: bigint('starts_at', { mode: 'number' }).notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  dailyWindowStart: bigint('daily_window_start', { mode: 'number' }).notNull(),
  weeklyWindowStart: bigint('weekly_window_start', { mode: 'number' }).notNull(),
  monthlyWindowStart: bigint('monthly_window_start', { mode: 'number' }).notNull(),
  dailyUsageUsd: doublePrecision('daily_usage_usd').notNull().default(0),
  weeklyUsageUsd: doublePrecision('weekly_usage_usd').notNull().default(0),
  monthlyUsageUsd: doublePrecision('monthly_usage_usd').notNull().default(0),
  assignedBy: text('assigned_by'), // admin username or 'purchase'
  note: text('note'),
  createdAt: epochMs('created_at'),
})

/**
 * A prepaid redeem code. Admins generate codes in batches; a user redeems one
 * to credit their wallet. The plaintext `code` is kept for admin export/reveal;
 * `codeHash` is what redemption looks up by, mirroring api_keys.
 */
export const redeemCodes = pgTable('redeem_codes', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(), // plaintext shown to admins / exported to customers
  codeHash: text('code_hash').notNull().unique(), // sha-256 of the code; redemption queries by this
  type: text('type').notNull().default('balance'), // balance (subscription added in a later phase)
  valueMicros: bigint('value_micros', { mode: 'number' }).notNull(), // face value in micro-USD
  status: text('status').notNull().default('unused'), // unused | used | disabled
  batchId: text('batch_id'), // groups codes minted together
  note: text('note'),
  redeemedBy: text('redeemed_by'), // user id that redeemed it
  redeemedAt: bigint('redeemed_at', { mode: 'number' }),
  walletTxnId: text('wallet_txn_id'), // the credit ledger entry, for traceability
  expiresAt: bigint('expires_at', { mode: 'number' }), // null = never expires
  createdBy: text('created_by'),
  createdAt: epochMs('created_at'),
})

/** A customer user who owns API keys and a prepaid USD wallet. */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash'),
  status: text('status').notNull().default('active'), // active | disabled
  concurrencyLimit: bigint('concurrency_limit', { mode: 'number' }), // max simultaneous in-flight requests across all the user's keys; null = unlimited
  balanceMicros: bigint('balance_micros', { mode: 'number' }).notNull().default(0),
  acceptedAt: bigint('accepted_at', { mode: 'number' }),
  lastLoginAt: bigint('last_login_at', { mode: 'number' }),
  createdAt: epochMs('created_at'),
})

/** One-time invitation token for customer signup. */
export const userInvites = pgTable('user_invites', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  acceptedAt: bigint('accepted_at', { mode: 'number' }),
  createdBy: text('created_by'),
  createdAt: epochMs('created_at'),
})

/** Immutable wallet ledger. Amounts are signed micro-USD values. */
export const walletTransactions = pgTable('wallet_transactions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  type: text('type').notNull(), // credit | debit | usage | adjustment
  amountMicros: bigint('amount_micros', { mode: 'number' }).notNull(),
  balanceAfterMicros: bigint('balance_after_micros', { mode: 'number' }).notNull(),
  usageLogId: text('usage_log_id'),
  note: text('note'),
  createdBy: text('created_by'),
  createdAt: epochMs('created_at'),
})

/** Recharge orders. Provider webhooks or admin confirmation settle these into wallet credits. */
export const paymentOrders = pgTable('payment_orders', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  provider: text('provider').notNull().default('manual'),
  status: text('status').notNull().default('pending'), // pending | paid | canceled | expired
  amountMicros: bigint('amount_micros', { mode: 'number' }).notNull(),
  providerOrderId: text('provider_order_id'),
  paymentUrl: text('payment_url'),
  walletTransactionId: text('wallet_transaction_id'),
  note: text('note'),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  paidAt: bigint('paid_at', { mode: 'number' }),
  canceledAt: bigint('canceled_at', { mode: 'number' }),
  createdAt: epochMs('created_at'),
  updatedAt: epochMs('updated_at'),
})

/** A platform API key issued to a user (yourself, a customer, or a friend). */
export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  name: text('name').notNull(),
  ownerLabel: text('owner_label'), // friendly name of who holds the key
  keyHash: text('key_hash').notNull().unique(), // sha-256 of the secret
  keySecretEncrypted: text('key_secret_encrypted'), // encrypted plaintext secret for admin reveal/copy
  keyPrefix: text('key_prefix').notNull(), // first chars, shown in the UI
  enabled: boolean('enabled').notNull().default(true),
  allowedProviders: jsonb('allowed_providers').$type<string[]>(),
  allowedModels: jsonb('allowed_models').$type<string[]>(),
  modelMappings: jsonb('model_mappings').$type<Record<string, string>>(),
  accountGroupId: text('account_group_id'), // null = 未绑定 → 默认池；非空时仅调度该组账号
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
  userId: text('user_id'),
  accountId: text('account_id'),
  provider: text('provider').notNull(),
  model: text('model'),
  requestInput: text('request_input'),
  sessionKeyHash: text('session_key_hash'),
  sessionSource: text('session_source'),
  ts: epochMs('ts'),
  inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
  outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
  reasoningTokens: bigint('reasoning_tokens', { mode: 'number' }).notNull().default(0), // thinking/reasoning tokens, a subset of output_tokens
  cacheCreateTokens: bigint('cache_create_tokens', { mode: 'number' }).notNull().default(0),
  cacheReadTokens: bigint('cache_read_tokens', { mode: 'number' }).notNull().default(0),
  cost: doublePrecision('cost').notNull().default(0), // amount charged to the user (base_cost × group multiplier)
  baseCost: doublePrecision('base_cost').notNull().default(0), // list-price cost before markup
  billTo: text('bill_to').notNull().default('balance'), // subscription | balance — which budget paid
  status: text('status').notNull().default('success'),
  latencyMs: bigint('latency_ms', { mode: 'number' }),
  firstTokenMs: bigint('first_token_ms', { mode: 'number' }),
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
