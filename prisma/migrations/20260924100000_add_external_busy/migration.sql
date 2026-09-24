-- Busy time imported from a doctor's own calendar (Practo Ray, Google, Outlook).
--
-- There was no way to block part of a day. leaveDates is @db.Date and takes the
-- whole day; an Appointment could not stand in for a block because patient_id
-- is NOT NULL, so a "busy" row would have needed a fake patient. Hence a table
-- rather than a column.
--
-- Intervals only, deliberately. The source feed may carry event titles naming
-- other patients, and importing those would pull another clinic system's
-- patient data into this one for no benefit. external_uid is opaque — it exists
-- to recognise the same event across syncs, never to display.
--
-- Additive: the running container ignores the table and the three new columns
-- until the deploy that reads them.
CREATE TABLE IF NOT EXISTS "external_busy" (
  "id"           TEXT         NOT NULL,
  "doctor_id"    TEXT         NOT NULL,
  "starts_at"    TIMESTAMP(3) NOT NULL,
  "ends_at"      TIMESTAMP(3) NOT NULL,
  "source"       TEXT         NOT NULL DEFAULT 'ICAL',
  "external_uid" TEXT,
  "synced_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_busy_pkey" PRIMARY KEY ("id")
);

-- The overlap query: one doctor's blocks that touch a window.
CREATE INDEX IF NOT EXISTS "external_busy_doctor_id_starts_at_ends_at_idx"
  ON "external_busy" ("doctor_id", "starts_at", "ends_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'external_busy_doctor_id_fkey'
  ) THEN
    ALTER TABLE "external_busy"
      ADD CONSTRAINT "external_busy_doctor_id_fkey"
      FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- The feed itself, and whether it is working. The URL is the credential for
-- these feeds, so it is never logged and is masked in the console once saved.
ALTER TABLE "doctors" ADD COLUMN IF NOT EXISTS "busy_feed_url" TEXT;
ALTER TABLE "doctors" ADD COLUMN IF NOT EXISTS "busy_feed_synced_at" TIMESTAMP(3);
ALTER TABLE "doctors" ADD COLUMN IF NOT EXISTS "busy_feed_error" TEXT;
