-- The WhatsApp 24-hour free-form window is per (business number, patient) pair,
-- not per patient. It previously lived on patients.last_inbound_at, which meant a
-- patient writing to one clinic opened a window another clinic's reminder job
-- believed it had.
--
-- Additive first, then the old column goes. Applied by hand, then baselined with
-- `prisma migrate resolve --applied`.
CREATE TABLE IF NOT EXISTS "messaging_windows" (
  "id"              TEXT NOT NULL,
  "patient_id"      TEXT NOT NULL,
  "doctor_id"       TEXT NOT NULL,
  "last_inbound_at" TIMESTAMP(3) NOT NULL,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "messaging_windows_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "messaging_windows_patient_id_doctor_id_key"
  ON "messaging_windows" ("patient_id", "doctor_id");
CREATE INDEX IF NOT EXISTS "messaging_windows_doctor_id_last_inbound_at_idx"
  ON "messaging_windows" ("doctor_id", "last_inbound_at");

DO $$
BEGIN
  ALTER TABLE "messaging_windows"
    ADD CONSTRAINT "messaging_windows_patient_id_fkey"
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "messaging_windows"
    ADD CONSTRAINT "messaging_windows_doctor_id_fkey"
    FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Carry existing values over, attributed to the only clinic that can have sent
-- them: the one whose WhatsApp number is configured. With a single live number
-- this is exact rather than a guess, and it stops every patient appearing
-- unreachable on the first day after deploy.
INSERT INTO "messaging_windows" ("id", "patient_id", "doctor_id", "last_inbound_at", "updated_at")
SELECT gen_random_uuid()::text, p."id", d."id", p."last_inbound_at", CURRENT_TIMESTAMP
FROM "patients" p
CROSS JOIN (
  SELECT "id" FROM "doctors" WHERE "whatsapp_phone_number_id" IS NOT NULL LIMIT 1
) d
WHERE p."last_inbound_at" IS NOT NULL
ON CONFLICT ("patient_id", "doctor_id") DO NOTHING;

-- Dropped rather than left behind: a column that looks like the source of truth
-- but is not is how this bug gets reintroduced.
ALTER TABLE "patients" DROP COLUMN IF EXISTS "last_inbound_at";
