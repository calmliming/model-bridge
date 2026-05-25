import { sqlite } from './index'

/** Adds a column to an existing table if it isn't there yet. */
function ensureColumn(table: string, column: string, ddl: string): void {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.find((c) => c.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`)
  }
}

/**
 * Creates every table if it does not already exist, then applies any
 * forward-compatible column additions. Runs on each boot so the app
 * starts with no separate migration step.
 */
export function initDb(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      name TEXT NOT NULL,
      oauth_access_token TEXT,
      oauth_refresh_token TEXT,
      token_expires_at INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      cooldown_until INTEGER,
      proxy_url TEXT,
      weight INTEGER NOT NULL DEFAULT 1,
      last_used_at INTEGER,
      metadata TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_label TEXT,
      key_hash TEXT NOT NULL UNIQUE,
      key_secret_encrypted TEXT,
      key_prefix TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      allowed_providers TEXT,
      allowed_models TEXT,
      rate_limit INTEGER,
      quota_limit REAL,
      quota_used REAL NOT NULL DEFAULT 0,
      expires_at INTEGER,
      last_used_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS usage_logs (
      id TEXT PRIMARY KEY,
      api_key_id TEXT,
      account_id TEXT,
      provider TEXT NOT NULL,
      model TEXT,
      ts INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_create_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'success',
      latency_ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_usage_logs_ts ON usage_logs (ts);
    CREATE INDEX IF NOT EXISTS idx_usage_logs_api_key ON usage_logs (api_key_id);

    CREATE TABLE IF NOT EXISTS model_pricing (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_price REAL NOT NULL DEFAULT 0,
      output_price REAL NOT NULL DEFAULT 0,
      cache_write_price REAL NOT NULL DEFAULT 0,
      cache_read_price REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS oauth_sessions (
      state TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      code_verifier TEXT NOT NULL,
      account_name TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  // Forward-compatible column additions for existing databases.
  ensureColumn('oauth_sessions', 'account_name', 'TEXT')
  ensureColumn('api_keys', 'key_secret_encrypted', 'TEXT')
}
