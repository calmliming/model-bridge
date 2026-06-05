CREATE TABLE IF NOT EXISTS "redeem_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"code_hash" text NOT NULL,
	"type" text DEFAULT 'balance' NOT NULL,
	"value_micros" bigint NOT NULL,
	"status" text DEFAULT 'unused' NOT NULL,
	"batch_id" text,
	"note" text,
	"redeemed_by" text,
	"redeemed_at" bigint,
	"wallet_txn_id" text,
	"expires_at" bigint,
	"created_by" text,
	"created_at" bigint NOT NULL,
	CONSTRAINT "redeem_codes_code_unique" UNIQUE("code"),
	CONSTRAINT "redeem_codes_code_hash_unique" UNIQUE("code_hash")
);
