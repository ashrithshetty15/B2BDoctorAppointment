-- Clinics: one WhatsApp number, many doctors.
--
-- Strictly additive. Nothing is dropped and nothing is narrowed, because local
-- .env and Railway share one database with no backups — code from either side
-- of the deploy has to keep working while this lands.
--
-- doctors.whatsapp_phone_number_id is deliberately left in place and populated.
-- The number is COPIED to the clinic, not moved, so old code routing by doctor
-- and new code routing by clinic both find it. Clearing it is a later change,
-- once nothing reads it.

CREATE TABLE IF NOT EXISTS "clinics" (
  "id"                       TEXT PRIMARY KEY,
  "name"                     TEXT NOT NULL,
  "whatsapp_phone_number_id" TEXT,
  "whatsapp_number"          TEXT,
  "missed_call_number"       TEXT,
  "api_key"                  TEXT NOT NULL,
  "timezone"                 TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  "default_language"         "Language" NOT NULL DEFAULT 'EN',
  "channel_status"           TEXT,
  "channel_reason"           TEXT,
  "channel_error_code"       INTEGER,
  "channel_source"           TEXT,
  "channel_checked_at"       TIMESTAMP(3),
  "status"                   "DoctorStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "clinics_whatsapp_phone_number_id_key"
  ON "clinics" ("whatsapp_phone_number_id");
CREATE UNIQUE INDEX IF NOT EXISTS "clinics_missed_call_number_key"
  ON "clinics" ("missed_call_number");
CREATE UNIQUE INDEX IF NOT EXISTS "clinics_api_key_key" ON "clinics" ("api_key");

ALTER TABLE "doctors" ADD COLUMN IF NOT EXISTS "clinic_id" TEXT;
ALTER TABLE "conversation_sessions" ADD COLUMN IF NOT EXISTS "clinic_id" TEXT;

-- Widening, not narrowing: a session has no doctor until the patient picks one.
-- Old code never writes NULL here, so it is unaffected.
ALTER TABLE "conversation_sessions" ALTER COLUMN "doctor_id" DROP NOT NULL;

-- Postgres treats NULLs as distinct, so this does not constrain the rows that
-- pre-date the column, and the existing (phone, doctor_id) key still stands.
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_sessions_phone_clinic_id_key"
  ON "conversation_sessions" ("phone", "clinic_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'doctors_clinic_id_fkey') THEN
    ALTER TABLE "doctors" ADD CONSTRAINT "doctors_clinic_id_fkey"
      FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_sessions_clinic_id_fkey') THEN
    ALTER TABLE "conversation_sessions" ADD CONSTRAINT "conversation_sessions_clinic_id_fkey"
      FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
