CREATE TABLE IF NOT EXISTS "subscription_checkouts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"group_id" text NOT NULL,
	"product_id" text NOT NULL,
	"store_id" text NOT NULL,
	"mode" text NOT NULL,
	"price" double precision NOT NULL,
	"status" text DEFAULT 'creating' NOT NULL,
	"session_id" text,
	"checkout_url" text,
	"provider_order_id" text,
	"subscription_id" text,
	"expires_at" bigint NOT NULL,
	"event_at" bigint DEFAULT 0 NOT NULL,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL,
	CONSTRAINT "subscription_checkouts_provider_order_id_unique" UNIQUE("provider_order_id"),
	CONSTRAINT "subscription_checkouts_subscription_id_unique" UNIQUE("subscription_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_events" (
	"id" text PRIMARY KEY NOT NULL,
	"checkout_id" text,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "payment_provider" text DEFAULT 'wallet' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "waffo_product_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_subscription_checkouts_user ON subscription_checkouts (user_id);
