-- Deeplink code, for clinics served by the shared platform number.
--
-- A clinic is identified one of two ways now. If it brings its own WhatsApp
-- number, Meta's phone_number_id names it and nothing changes — that is how
-- Dentin and Jalaja work. If it has no WABA of its own, the shared platform
-- number serves it and this code, carried in the deeplink's prefilled text,
-- says which clinic a patient means.
--
-- The second route exists because Meta business verification is the single
-- biggest obstacle to onboarding a small practice: it turns weeks of waiting
-- into printing a QR code. A clinic that later wants its own name as the sender
-- upgrades to its own number, and simply stops needing this column.
--
-- Strictly additive and safe to run ahead of the deploy:
--   * nullable with no default, so every existing row stays valid and untouched
--   * the unique index tolerates many NULLs in Postgres, so all current clinics
--     (code IS NULL) coexist happily
--   * nothing reads it until PLATFORM_PHONE_NUMBER_ID is set, which it is not

ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "code" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "clinics_code_key" ON "clinics" ("code");
