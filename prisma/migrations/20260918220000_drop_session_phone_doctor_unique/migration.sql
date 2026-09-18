-- Drop the old (phone, doctor_id) unique on conversation_sessions.
--
-- Sessions are keyed on (phone, clinic_id) now; doctor_id became ordinary
-- session state that changes when a patient switches doctor. A unique index on
-- a mutable field is a trap, and it sprang: a patient with a pre-migration row
-- for (their number, Dr. Meera) could not switch to Dr. Meera, because the
-- upsert on (phone, clinic_id) then tried to write a doctor_id that already
-- existed on that older row. Every turn threw and the patient saw "something
-- went wrong on our side".
--
-- The index was kept during the migration on the reasoning that Postgres treats
-- NULLs as distinct so old rows could not collide. That holds for the new
-- (phone, clinic_id) index, where old rows have clinic_id NULL. It does not
-- hold here: the old rows carry a real doctor_id and collide head on.
--
-- Safe to drop while the current build runs — nothing in the application
-- references this key, and dropping an index loses no data.
DROP INDEX IF EXISTS "conversation_sessions_phone_doctor_id_key";

-- Pre-migration rows, all long expired: they belong to no clinic, so no
-- conversation can ever load them again, and they only sit there waiting to
-- collide with a doctor_id a live session wants.
DELETE FROM "conversation_sessions" WHERE "clinic_id" IS NULL;
