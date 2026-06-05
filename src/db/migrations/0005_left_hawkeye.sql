CREATE TABLE IF NOT EXISTS "subscription_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"group_id" text NOT NULL,
	"price" double precision DEFAULT 0 NOT NULL,
	"daily_limit_usd" double precision,
	"weekly_limit_usd" double precision,
	"monthly_limit_usd" double precision,
	"validity_days" bigint DEFAULT 30 NOT NULL,
	"for_sale" boolean DEFAULT false NOT NULL,
	"sort_order" bigint DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"group_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"starts_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"daily_window_start" bigint NOT NULL,
	"weekly_window_start" bigint NOT NULL,
	"monthly_window_start" bigint NOT NULL,
	"daily_usage_usd" double precision DEFAULT 0 NOT NULL,
	"weekly_usage_usd" double precision DEFAULT 0 NOT NULL,
	"monthly_usage_usd" double precision DEFAULT 0 NOT NULL,
	"assigned_by" text,
	"note" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "bill_to" text DEFAULT 'balance' NOT NULL;