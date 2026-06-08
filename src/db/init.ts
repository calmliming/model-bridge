import { pool } from './index'

/**
 * Creates every table if it does not already exist, then applies any
 * forward-compatible column additions. Runs on each boot so the app
 * starts with no separate migration step.
 */
export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      name TEXT NOT NULL,
      oauth_access_token TEXT,
      oauth_refresh_token TEXT,
      token_expires_at BIGINT,
      status TEXT NOT NULL DEFAULT 'active',
      cooldown_until BIGINT,
      proxy_url TEXT,
      weight BIGINT NOT NULL DEFAULT 1,
      concurrency_limit BIGINT,
      last_used_at BIGINT,
      group_id TEXT,
      notes TEXT,
      metadata JSONB,
      created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
    );

    CREATE TABLE IF NOT EXISTS account_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      rate_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1,
      created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
    );

    CREATE TABLE IF NOT EXISTS account_group_members (
      account_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      weight BIGINT,
      created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
      PRIMARY KEY (account_id, group_id)
    );
    CREATE INDEX IF NOT EXISTS idx_agm_group_id ON account_group_members (group_id);

    CREATE TABLE IF NOT EXISTS subscription_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      group_id TEXT NOT NULL,
      price DOUBLE PRECISION NOT NULL DEFAULT 0,
      daily_limit_usd DOUBLE PRECISION,
      weekly_limit_usd DOUBLE PRECISION,
      monthly_limit_usd DOUBLE PRECISION,
      validity_days BIGINT NOT NULL DEFAULT 30,
      for_sale BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order BIGINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
    );

    CREATE TABLE IF NOT EXISTS user_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      starts_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      daily_window_start BIGINT NOT NULL,
      weekly_window_start BIGINT NOT NULL,
      monthly_window_start BIGINT NOT NULL,
      daily_usage_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      weekly_usage_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      monthly_usage_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      assigned_by TEXT,
      note TEXT,
      created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user ON user_subscriptions (user_id);
    CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_group ON user_subscriptions (user_id, group_id, status);

    CREATE TABLE IF NOT EXISTS redeem_codes (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      code_hash TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'balance',
      value_micros BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unused',
      batch_id TEXT,
      note TEXT,
      redeemed_by TEXT,
      redeemed_at BIGINT,
      wallet_txn_id TEXT,
      expires_at BIGINT,
      created_by TEXT,
      created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_redeem_codes_batch_id ON redeem_codes (batch_id);
    CREATE INDEX IF NOT EXISTS idx_redeem_codes_status ON redeem_codes (status);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      balance_micros BIGINT NOT NULL DEFAULT 0,
      accepted_at BIGINT,
      last_login_at BIGINT,
      created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
    );

    CREATE TABLE IF NOT EXISTS user_invites (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at BIGINT NOT NULL,
      accepted_at BIGINT,
      created_by TEXT,
      created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_user_invites_user_id ON user_invites (user_id);
    CREATE INDEX IF NOT EXISTS idx_user_invites_expires_at ON user_invites (expires_at);

    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount_micros BIGINT NOT NULL,
      balance_after_micros BIGINT NOT NULL,
      usage_log_id TEXT,
      note TEXT,
      created_by TEXT,
      created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id ON wallet_transactions (user_id);
    CREATE INDEX IF NOT EXISTS idx_wallet_transactions_created_at ON wallet_transactions (created_at);

    CREATE TABLE IF NOT EXISTS payment_orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'pending',
      amount_micros BIGINT NOT NULL,
      provider_order_id TEXT,
      payment_url TEXT,
      wallet_transaction_id TEXT,
      note TEXT,
      expires_at BIGINT NOT NULL,
      paid_at BIGINT,
      canceled_at BIGINT,
      created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
      updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_payment_orders_user_id ON payment_orders (user_id);
    CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders (status);
    CREATE INDEX IF NOT EXISTS idx_payment_orders_created_at ON payment_orders (created_at);
    CREATE INDEX IF NOT EXISTS idx_payment_orders_provider_order_id ON payment_orders (provider_order_id);

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT NOT NULL,
      owner_label TEXT,
      key_hash TEXT NOT NULL UNIQUE,
      key_secret_encrypted TEXT,
      key_prefix TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      allowed_providers JSONB,
      allowed_models JSONB,
      model_mappings JSONB,
      rate_limit BIGINT,
      concurrency_limit BIGINT,
      quota_limit DOUBLE PRECISION,
      quota_used DOUBLE PRECISION NOT NULL DEFAULT 0,
      expires_at BIGINT,
      last_used_at BIGINT,
      created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
    );

    CREATE TABLE IF NOT EXISTS usage_logs (
      id TEXT PRIMARY KEY,
      api_key_id TEXT,
      user_id TEXT,
      account_id TEXT,
      provider TEXT NOT NULL,
      model TEXT,
      request_input TEXT,
      ts BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
      input_tokens BIGINT NOT NULL DEFAULT 0,
      output_tokens BIGINT NOT NULL DEFAULT 0,
      cache_create_tokens BIGINT NOT NULL DEFAULT 0,
      cache_read_tokens BIGINT NOT NULL DEFAULT 0,
      cost DOUBLE PRECISION NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'success',
      latency_ms BIGINT,
      first_token_ms BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_usage_logs_ts ON usage_logs (ts);
    CREATE INDEX IF NOT EXISTS idx_usage_logs_api_key ON usage_logs (api_key_id);

    CREATE TABLE IF NOT EXISTS model_pricing (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_price DOUBLE PRECISION NOT NULL DEFAULT 0,
      output_price DOUBLE PRECISION NOT NULL DEFAULT 0,
      cache_write_price DOUBLE PRECISION NOT NULL DEFAULT 0,
      cache_read_price DOUBLE PRECISION NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS oauth_sessions (
      state TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      code_verifier TEXT NOT NULL,
      account_name TEXT,
      created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  // Forward-compatible column additions for existing databases.
  // PostgreSQL 9.6+ supports IF NOT EXISTS on ADD COLUMN, so this is idempotent.
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS weight BIGINT NOT NULL DEFAULT 1;`)
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS concurrency_limit BIGINT;`)
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS notes TEXT;`)
  await pool.query(`ALTER TABLE oauth_sessions ADD COLUMN IF NOT EXISTS account_name TEXT;`)
  await pool.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_secret_encrypted TEXT;`)
  await pool.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS allowed_models JSONB;`)
  await pool.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS model_mappings JSONB;`)
  await pool.query(`ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS request_input TEXT;`)
  await pool.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS concurrency_limit BIGINT;`)
  await pool.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS user_id TEXT;`)
  await pool.query(`ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS user_id TEXT;`)
  await pool.query(`ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS first_token_ms BIGINT;`)
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS group_id TEXT;`)
  await pool.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS account_group_id TEXT;`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_accounts_group_id ON accounts (group_id);`)
  await pool.query(`ALTER TABLE account_groups ADD COLUMN IF NOT EXISTS rate_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1;`)
  await pool.query(`ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS base_cost DOUBLE PRECISION NOT NULL DEFAULT 0;`)
  await pool.query(`ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS bill_to TEXT NOT NULL DEFAULT 'balance';`)
  await pool.query(`CREATE TABLE IF NOT EXISTS subscription_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    group_id TEXT NOT NULL,
    price DOUBLE PRECISION NOT NULL DEFAULT 0,
    daily_limit_usd DOUBLE PRECISION,
    weekly_limit_usd DOUBLE PRECISION,
    monthly_limit_usd DOUBLE PRECISION,
    validity_days BIGINT NOT NULL DEFAULT 30,
    for_sale BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order BIGINT NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
  );`)
  await pool.query(`CREATE TABLE IF NOT EXISTS user_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    starts_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    daily_window_start BIGINT NOT NULL,
    weekly_window_start BIGINT NOT NULL,
    monthly_window_start BIGINT NOT NULL,
    daily_usage_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    weekly_usage_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    monthly_usage_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    assigned_by TEXT,
    note TEXT,
    created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
  );`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user ON user_subscriptions (user_id);`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_group ON user_subscriptions (user_id, group_id, status);`)
  await pool.query(`CREATE TABLE IF NOT EXISTS account_group_members (
    account_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    weight BIGINT,
    created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
    PRIMARY KEY (account_id, group_id)
  );`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_agm_group_id ON account_group_members (group_id);`)
  await pool.query(`CREATE TABLE IF NOT EXISTS account_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
  );`)
  await pool.query(`CREATE TABLE IF NOT EXISTS payment_orders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'manual',
    status TEXT NOT NULL DEFAULT 'pending',
    amount_micros BIGINT NOT NULL,
    provider_order_id TEXT,
    payment_url TEXT,
    wallet_transaction_id TEXT,
    note TEXT,
    expires_at BIGINT NOT NULL,
    paid_at BIGINT,
    canceled_at BIGINT,
    created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
    updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
  );`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys (user_id);`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs (user_id);`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_payment_orders_user_id ON payment_orders (user_id);`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders (status);`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_payment_orders_created_at ON payment_orders (created_at);`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_payment_orders_provider_order_id ON payment_orders (provider_order_id);`)

  // One-time backfill: migrate the legacy single-group accounts.group_id into
  // the many-to-many membership table. Gated by a settings flag so it runs
  // exactly once — otherwise an admin removing a membership would see it
  // reappear on the next boot. The old group_id column is kept (deprecated).
  const backfilled = await pool.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'agm_backfilled'`,
  )
  if (backfilled.rows[0]?.value !== '1') {
    await pool.query(
      `INSERT INTO account_group_members (account_id, group_id, weight, created_at)
       SELECT id, group_id, NULL, created_at FROM accounts WHERE group_id IS NOT NULL
       ON CONFLICT (account_id, group_id) DO NOTHING`,
    )
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('agm_backfilled', '1')
       ON CONFLICT (key) DO UPDATE SET value = '1'`,
    )
  }
}
