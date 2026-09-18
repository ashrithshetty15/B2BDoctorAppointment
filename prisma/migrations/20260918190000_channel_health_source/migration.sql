-- Provenance for the channel health reading: "poll" or "send".
--
-- Additive only. Existing rows stay NULL, which the code treats as a poll —
-- the conservative reading, since nothing has been proven by a real send yet.
ALTER TABLE "doctors" ADD COLUMN IF NOT EXISTS "channel_source" TEXT;
