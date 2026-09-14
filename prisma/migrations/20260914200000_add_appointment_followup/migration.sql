-- Follow-up decided during a consult: when the patient should come back, and
-- whether we have managed to tell them.
-- Additive and idempotent: applied by hand to the live database, then baselined
-- with `prisma migrate resolve --applied`.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "follow_up_on" DATE;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "follow_up_sent_at" TIMESTAMP(3);

-- Drives the due-follow-ups sweep (due on or before today, not yet sent).
CREATE INDEX IF NOT EXISTS "appointments_doctor_id_follow_up_on_follow_up_sent_at_idx"
  ON "appointments" ("doctor_id", "follow_up_on", "follow_up_sent_at");
