ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "quota_mode" text DEFAULT 'spend' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "five_hour_limit_points" double precision;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "weekly_limit_points" double precision;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "monthly_limit_points" double precision;--> statement-breakpoint
ALTER TABLE "user_subscriptions" ADD COLUMN IF NOT EXISTS "five_hour_window_start" bigint;--> statement-breakpoint
ALTER TABLE "user_subscriptions" ADD COLUMN IF NOT EXISTS "five_hour_usage_points" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_subscriptions" ADD COLUMN IF NOT EXISTS "weekly_points_start" bigint;--> statement-breakpoint
ALTER TABLE "user_subscriptions" ADD COLUMN IF NOT EXISTS "weekly_usage_points" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_subscriptions" ADD COLUMN IF NOT EXISTS "monthly_points_start" bigint;--> statement-breakpoint
ALTER TABLE "user_subscriptions" ADD COLUMN IF NOT EXISTS "monthly_usage_points" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_subscriptions" ADD COLUMN IF NOT EXISTS "billing_period_start" bigint;--> statement-breakpoint
ALTER TABLE "user_subscriptions" ADD COLUMN IF NOT EXISTS "billing_period_end" bigint;