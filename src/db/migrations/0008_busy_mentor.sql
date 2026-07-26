ALTER TABLE "model_pricing" ADD COLUMN "image_input_price" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_pricing" ADD COLUMN "image_output_price" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "image_input_tokens" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "image_output_tokens" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "image_count" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "image_size" text;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "image_model" text;