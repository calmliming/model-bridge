CREATE TABLE "relay_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"api_key_id" text NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text,
	"estimated_micros" bigint NOT NULL,
	"balance_reserved_micros" bigint NOT NULL,
	"lease_expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "relay_reservations_owner" ON "relay_reservations" USING btree ("user_id","api_key_id");--> statement-breakpoint
CREATE INDEX "relay_reservations_account" ON "relay_reservations" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "relay_reservations_expiry" ON "relay_reservations" USING btree ("lease_expires_at");