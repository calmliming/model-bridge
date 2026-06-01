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
      last_used_at BIGINT,
      metadata JSONB,
      created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
    );

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
      latency_ms BIGINT
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
  await pool.query(`ALTER TABLE oauth_sessions ADD COLUMN IF NOT EXISTS account_name TEXT;`)
  await pool.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_secret_encrypted TEXT;`)
  await pool.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS allowed_models JSONB;`)
  await pool.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS model_mappings JSONB;`)
  await pool.query(`ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS request_input TEXT;`)
  await pool.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS concurrency_limit BIGINT;`)
  await pool.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS user_id TEXT;`)
  await pool.query(`ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS user_id TEXT;`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys (user_id);`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs (user_id);`)
}
