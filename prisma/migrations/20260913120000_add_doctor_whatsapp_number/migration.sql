-- Adds the dialable WhatsApp number used to build the booking link and QR code.
--
-- missed_call_number is included because it was applied with `prisma db push`
-- rather than a migration, leaving the migration history behind the live
-- database. IF NOT EXISTS makes this a no-op where the column already exists
-- and reconciles a fresh database, so both paths converge on the same schema.

ALTER TABLE "doctors" ADD COLUMN IF NOT EXISTS "missed_call_number" TEXT;
ALTER TABLE "doctors" ADD COLUMN IF NOT EXISTS "whatsapp_number" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "doctors_missed_call_number_key"
  ON "doctors"("missed_call_number");
