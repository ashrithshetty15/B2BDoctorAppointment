-- A cancelled appointment was holding its slot forever.
--
-- appointments_doctor_id_slot_start_key was unconditional, so once ANY row had
-- existed at (doctor_id, slot_start) that slot could never be booked again — by
-- anyone, ever. getAvailableSlots correctly ignores cancelled rows, so the bot
-- kept offering the time; bookSlot and moveSlot detect a clash by catching the
-- unique violation as P2002, so the patient was told "sorry, that time was just
-- booked" about a slot nobody held.
--
-- Reported as: a patient could not reschedule to 10:00, a time they themselves
-- had cancelled earlier. Dr Kiran Shetty alone had three slots dead this way.
--
-- The index becomes partial so it constrains only appointments that actually
-- occupy the slot. CANCELLED and NO_SHOW rows are kept — they are the clinic's
-- history — but they no longer reserve anything.
--
-- Safe to run in one transaction: verified zero duplicate active slots first,
-- so the CREATE cannot fail and leave the table unprotected. DDL is
-- transactional in Postgres, so there is no window without a unique constraint.

BEGIN;

DROP INDEX IF EXISTS "appointments_doctor_id_slot_start_key";

CREATE UNIQUE INDEX "appointments_doctor_id_slot_start_key"
  ON "appointments" ("doctor_id", "slot_start")
  WHERE "status" NOT IN ('CANCELLED', 'NO_SHOW');

COMMIT;
