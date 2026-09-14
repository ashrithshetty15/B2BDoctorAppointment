-- Staff-only remark on an appointment, captured at booking or during the visit.
-- Additive and idempotent: already applied by hand to the live database.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "notes" TEXT;
