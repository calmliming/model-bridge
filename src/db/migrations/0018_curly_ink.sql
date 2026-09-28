CREATE TABLE IF NOT EXISTS "pending_user_registrations" (
	"email" text PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"sent_at" bigint NOT NULL,
	"attempts" bigint DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pending_user_registrations_expires_at" ON "pending_user_registrations" USING btree ("expires_at");