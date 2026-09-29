ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "usage_profile" text DEFAULT 'base' NOT NULL;
