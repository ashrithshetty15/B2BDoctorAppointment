-- Per-clinic WhatsApp channel health, so a provider-side block (unpaid account,
-- unapproved display name, missing asset) is visible in the console instead of
-- being discovered hours later by reading logs.
-- Additive only: applied by hand, then baselined with `migrate resolve --applied`.
ALTER TABLE "doctors" ADD COLUMN IF NOT EXISTS "channel_status" TEXT;
ALTER TABLE "doctors" ADD COLUMN IF NOT EXISTS "channel_reason" TEXT;
ALTER TABLE "doctors" ADD COLUMN IF NOT EXISTS "channel_error_code" INTEGER;
ALTER TABLE "doctors" ADD COLUMN IF NOT EXISTS "channel_checked_at" TIMESTAMP(3);
