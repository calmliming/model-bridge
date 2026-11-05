import { pool } from '../db'

export async function initManagementDb(): Promise<void> {
  await pool.query(`
    ALTER TABLE account_groups ADD COLUMN IF NOT EXISTS image_billing_mode TEXT NOT NULL DEFAULT 'both';
    CREATE TABLE IF NOT EXISTS management_keys (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, prefix TEXT NOT NULL,
      policy JSONB NOT NULL, allowed_ips JSONB NOT NULL DEFAULT '[]', expires_at BIGINT,
      enabled BOOLEAN NOT NULL DEFAULT TRUE, version BIGINT NOT NULL DEFAULT 1,
      created_at BIGINT NOT NULL, revoked_at BIGINT
    );
    CREATE TABLE IF NOT EXISTS management_audit (
      id BIGSERIAL PRIMARY KEY, actor TEXT NOT NULL, operation TEXT NOT NULL,
      resource_id TEXT, status TEXT NOT NULL, created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS management_audit_created ON management_audit(created_at DESC);
    CREATE TABLE IF NOT EXISTS management_idempotency (
      id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, status TEXT NOT NULL,
      response JSONB, created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mcp_grants (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, role TEXT NOT NULL, fingerprint TEXT NOT NULL,
      client_id TEXT NOT NULL, client_name TEXT NOT NULL, redirect_uri TEXT NOT NULL, resource TEXT NOT NULL,
      challenge TEXT NOT NULL, code_hash TEXT UNIQUE, code_used BOOLEAN NOT NULL DEFAULT FALSE,
      access_hash TEXT UNIQUE, access_expires_at BIGINT, refresh_hash TEXT UNIQUE,
      created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL, revoked_at BIGINT
    );
    ALTER TABLE mcp_grants ADD COLUMN IF NOT EXISTS resource TEXT;
    UPDATE mcp_grants SET revoked_at = COALESCE(revoked_at, (EXTRACT(EPOCH FROM NOW())*1000)::bigint) WHERE resource IS NULL;
    CREATE INDEX IF NOT EXISTS mcp_grants_owner ON mcp_grants(user_id);
    CREATE TABLE IF NOT EXISTS mcp_token_history (
      token_hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL REFERENCES mcp_grants(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL
    );
  `)
}
