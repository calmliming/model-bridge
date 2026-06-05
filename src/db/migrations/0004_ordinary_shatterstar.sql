CREATE TABLE IF NOT EXISTS "account_group_members" (
	"account_id" text NOT NULL,
	"group_id" text NOT NULL,
	"weight" bigint,
	"created_at" bigint NOT NULL,
	CONSTRAINT "account_group_members_account_id_group_id_pk" PRIMARY KEY("account_id","group_id")
);
--> statement-breakpoint
ALTER TABLE "account_groups" ADD COLUMN "rate_multiplier" double precision DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "base_cost" double precision DEFAULT 0 NOT NULL;