-- Read-only key for the waiting-room board.
--
-- Additive and nullable: existing doctors get one when they first open the
-- board's link from settings, so nothing has to be backfilled and no running
-- code is affected.
--
-- Separate from api_key on purpose. The board's URL lives on a wall.
ALTER TABLE "doctors" ADD COLUMN IF NOT EXISTS "display_key" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "doctors_display_key_key"
  ON "doctors" ("display_key");
