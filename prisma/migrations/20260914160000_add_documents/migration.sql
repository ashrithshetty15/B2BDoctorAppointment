-- Reference documents (lab reports, prescriptions, scans) attached to a visit.
-- Additive and idempotent: applied by hand to the live database, then baselined
-- with `prisma migrate resolve --applied`.
CREATE TABLE IF NOT EXISTS "documents" (
  "id"             TEXT NOT NULL,
  "appointment_id" TEXT NOT NULL,
  "doctor_id"      TEXT NOT NULL,
  "filename"       TEXT NOT NULL,
  "content_type"   TEXT NOT NULL,
  "size_bytes"     INTEGER NOT NULL,
  "storage_key"    TEXT,
  "inline_data"    TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "documents_appointment_id_idx" ON "documents" ("appointment_id");
CREATE INDEX IF NOT EXISTS "documents_doctor_id_created_at_idx" ON "documents" ("doctor_id", "created_at");

-- Deleting an appointment or a doctor takes its documents with it; a row whose
-- appointment is gone would be an orphaned medical record with no owner.
DO $$
BEGIN
  ALTER TABLE "documents"
    ADD CONSTRAINT "documents_appointment_id_fkey"
    FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "documents"
    ADD CONSTRAINT "documents_doctor_id_fkey"
    FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
