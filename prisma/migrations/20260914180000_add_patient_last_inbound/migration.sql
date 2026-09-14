-- When the patient last messaged us. Drives the WhatsApp 24-hour-window check
-- that tells a doctor which patients a day-closure can actually reach.
-- Additive and idempotent: applied by hand to the live database, then baselined
-- with `prisma migrate resolve --applied`.
ALTER TABLE "patients" ADD COLUMN IF NOT EXISTS "last_inbound_at" TIMESTAMP(3);
