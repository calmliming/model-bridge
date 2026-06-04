CREATE TABLE IF NOT EXISTS "account_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "group_id" text;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "account_group_id" text;