CREATE TABLE IF NOT EXISTS "payment_notification_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"notify_id" text NOT NULL,
	"out_trade_no" text NOT NULL,
	"provider_order_id" text,
	"trade_status" text,
	"raw_data" jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "payment_notification_events_notify_id_unique" UNIQUE("notify_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_order_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount_micros" bigint NOT NULL,
	"provider_amount" text NOT NULL,
	"provider_currency" text DEFAULT 'CNY' NOT NULL,
	"reason" text,
	"wallet_transaction_id" text,
	"provider_response" jsonb,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_orders" ADD COLUMN IF NOT EXISTS "payment_html" text;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD COLUMN IF NOT EXISTS "provider_amount" text;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD COLUMN IF NOT EXISTS "provider_currency" text;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD COLUMN IF NOT EXISTS "trade_status" text;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD COLUMN IF NOT EXISTS "refunded_amount_micros" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "error_code" text;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "error_message" text;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "upstream_status" bigint;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "attempt_count" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "upstream_model" text;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "model_mismatch" boolean DEFAULT false NOT NULL;
