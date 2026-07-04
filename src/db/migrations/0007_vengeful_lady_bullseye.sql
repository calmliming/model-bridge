ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "session_key_hash" text;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "session_source" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_logs_session_key_hash" ON "usage_logs" ("session_key_hash");--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "reasoning_tokens" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "concurrency_limit" bigint;
