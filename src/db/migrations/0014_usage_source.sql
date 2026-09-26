ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "usage_source" text DEFAULT 'unknown' NOT NULL;
