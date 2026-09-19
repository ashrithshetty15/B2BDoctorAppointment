-- Where the booking came from.
--
-- The queue guessed it: a TOKEN row with no slot time was labelled "Walk-in",
-- which is also exactly what a token booked over WhatsApp looks like. Rather
-- than show a source that is wrong half the time, record it.
--
-- Additive with a default, so existing rows read WHATSAPP — true of every
-- booking made before the walk-in form existed, and the safe reading after.
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'WHATSAPP';
