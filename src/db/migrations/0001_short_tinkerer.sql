CREATE TABLE IF NOT EXISTS "payment_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount_micros" bigint NOT NULL,
	"provider_order_id" text,
	"payment_url" text,
	"wallet_transaction_id" text,
	"note" text,
	"expires_at" bigint NOT NULL,
	"paid_at" bigint,
	"canceled_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payment_orders_user_id" ON "payment_orders" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payment_orders_status" ON "payment_orders" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payment_orders_created_at" ON "payment_orders" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payment_orders_provider_order_id" ON "payment_orders" ("provider_order_id");
