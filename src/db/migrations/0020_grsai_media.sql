CREATE TABLE IF NOT EXISTS "media_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"upstream_id" text,
	"api_key_id" text NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"base_url" text NOT NULL,
	"model" text NOT NULL,
	"requested_model" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"progress" double precision DEFAULT 0 NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"request_input" text,
	"request_params" jsonb NOT NULL,
	"billing" jsonb NOT NULL,
	"estimated_micros" bigint NOT NULL,
	"settled" boolean DEFAULT false NOT NULL,
	"next_poll_at" bigint NOT NULL,
	"polling_until" bigint DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "model_pricing" ADD COLUMN "image_request_price" double precision;--> statement-breakpoint
ALTER TABLE "model_pricing" ADD COLUMN "video_second_480_price" double precision;--> statement-breakpoint
ALTER TABLE "model_pricing" ADD COLUMN "video_second_768_price" double precision;--> statement-breakpoint
ALTER TABLE "model_pricing" ADD COLUMN "video_second_1080_price" double precision;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "video_seconds" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "video_resolution" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_tasks_pending" ON "media_tasks" USING btree ("next_poll_at") WHERE "media_tasks"."settled" = FALSE;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_tasks_owner" ON "media_tasks" USING btree ("user_id","api_key_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_tasks_account" ON "media_tasks" USING btree ("account_id") WHERE "media_tasks"."settled" = FALSE;