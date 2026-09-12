ALTER TABLE "model_pricing" ADD COLUMN IF NOT EXISTS "image_cache_read_price" double precision;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "image_cache_read_tokens" bigint DEFAULT 0 NOT NULL;
