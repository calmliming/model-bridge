ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "upstream_request_id" text;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "service_tier" text;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "reasoning_effort" text;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "billing_price" jsonb;