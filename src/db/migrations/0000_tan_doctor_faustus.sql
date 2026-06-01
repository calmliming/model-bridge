CREATE TABLE IF NOT EXISTS "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"oauth_access_token" text,
	"oauth_refresh_token" text,
	"token_expires_at" bigint,
	"status" text DEFAULT 'active' NOT NULL,
	"cooldown_until" bigint,
	"proxy_url" text,
	"weight" bigint DEFAULT 1 NOT NULL,
	"last_used_at" bigint,
	"metadata" jsonb,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"owner_label" text,
	"key_hash" text NOT NULL,
	"key_secret_encrypted" text,
	"key_prefix" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"allowed_providers" jsonb,
	"allowed_models" jsonb,
	"model_mappings" jsonb,
	"rate_limit" bigint,
	"concurrency_limit" bigint,
	"quota_limit" double precision,
	"quota_used" double precision DEFAULT 0 NOT NULL,
	"expires_at" bigint,
	"last_used_at" bigint,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_pricing" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_price" double precision DEFAULT 0 NOT NULL,
	"output_price" double precision DEFAULT 0 NOT NULL,
	"cache_write_price" double precision DEFAULT 0 NOT NULL,
	"cache_read_price" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_sessions" (
	"state" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"code_verifier" text NOT NULL,
	"account_name" text,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"api_key_id" text,
	"user_id" text,
	"account_id" text,
	"provider" text NOT NULL,
	"model" text,
	"request_input" text,
	"ts" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_create_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_read_tokens" bigint DEFAULT 0 NOT NULL,
	"cost" double precision DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'success' NOT NULL,
	"latency_ms" bigint,
	"first_token_ms" bigint
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"accepted_at" bigint,
	"created_by" text,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL,
	CONSTRAINT "user_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"status" text DEFAULT 'active' NOT NULL,
	"balance_micros" bigint DEFAULT 0 NOT NULL,
	"accepted_at" bigint,
	"last_login_at" bigint,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallet_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"amount_micros" bigint NOT NULL,
	"balance_after_micros" bigint NOT NULL,
	"usage_log_id" text,
	"note" text,
	"created_by" text,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "user_id" text;
--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "user_id" text;
--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "first_token_ms" bigint;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_api_keys_user_id" ON "api_keys" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_logs_ts" ON "usage_logs" ("ts");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_logs_api_key" ON "usage_logs" ("api_key_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_logs_user_id" ON "usage_logs" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_invites_user_id" ON "user_invites" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_invites_expires_at" ON "user_invites" ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wallet_transactions_user_id" ON "wallet_transactions" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_wallet_transactions_created_at" ON "wallet_transactions" ("created_at");
