ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "subscription_id" text;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "subscription_points" double precision;