CREATE TABLE IF NOT EXISTS "live_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"api_key_id" text NOT NULL,
	"user_id" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"requested_model" text NOT NULL,
	"request_input" text,
	"status" text DEFAULT 'running' NOT NULL,
	"usage_log_id" text,
	"error_code" text,
	"error_message" text,
	"http_status" integer,
	"created_at" bigint NOT NULL,
	"finished_at" bigint,
	"lease_expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "live_requests_owner" ON "live_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "live_requests_usage" ON "live_requests" USING btree ("usage_log_id");