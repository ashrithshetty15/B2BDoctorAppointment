import { type Appointment, type Doctor, Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { prisma } from '../db/prisma';
import { atLocalTime, formatDateOnly } from '../utils/time';
import { isOnLeave } from './tokenQueue';

/**
 * Slot engine (requirement 5): availability derived from Doctor.working_hours
 * and consult_duration_mins, minus already-booked slots, leave_dates and any
 * slot already in the past.
 *
 * The SLOT *conversation* flow is still a stub (Section 4 was not supplied) —
 * this module is what it will call, and what the dashboard uses to show a day.
 */

export interface Window {
  /** "HH:mm" local to the doctor's timezone. */
  start: string;
  end: string;
}

export type WorkingHours = Partial<Record<DayKey, Window[]>>;

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** Canonical order, Monday first. Exported so nothing else redeclares it. */
export const DAY_KEYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export interface Slot {
  start: Date;
  end: Date;
}

/** Tolerant parse — a malformed working_hours blob yields no availability, not a crash. */
export function parseWorkingHours(raw: unknown): WorkingHours {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: WorkingHours = {};

  for (const key of DAY_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (!Array.isArray(value)) continue;

    const windows = value.filter(
      (w): w is Window =>
        !!w &&
        typeof w === 'object' &&
        typeof (w as Window).start === 'string' &&
        typeof (w as Window).end === 'string' &&
        /^\d{1,2}:\d{2}$/.test((w as Window).start) &&
        /^\d{1,2}:\d{2}$/.test((w as Window).end),
    );
    if (windows.length) out[key] = windows;
  }

  return out;
}

export function dayKeyFor(date: Date): DayKey {
  // Prisma @db.Date values are UTC midnight; weekday 1 = Monday.
  const weekday = DateTime.fromJSDate(date, { zone: 'utc' }).weekday;
  return DAY_KEYS[weekday - 1] ?? 'mon';
}

/** Every slot the doctor's schedule defines for a date, ignoring bookings. */
export function generateSlots(doctor: Doctor, date: Date): Slot[] {
  if (isOnLeave(doctor, date)) return [];

  const hours = parseWorkingHours(doctor.workingHours);
  const windows = hours[dayKeyFor(date)] ?? [];
  const durationMs = Math.max(1, doctor.consultDurationMins) * 60_000;

  const slots: Slot[] = [];

  for (const window of windows) {
    const windowStart = atLocalTime(date, window.start, doctor.timezone);
    const windowEnd = atLocalTime(date, window.end, doctor.timezone);
    if (!windowStart || !windowEnd || windowEnd <= windowStart) continue;

    for (let cursor = windowStart.getTime(); cursor + durationMs <= windowEnd.getTime(); cursor += durationMs) {
      slots.push({ start: new Date(cursor), end: new Date(cursor + durationMs) });
    }
  }

  return slots.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Slots a patient can actually pick right now. */
export async function getAvailableSlots(
  doctor: Doctor,
  date: Date,
  now: Date = new Date(),
): Promise<Slot[]> {
  const candidates = generateSlots(doctor, date);
  if (!candidates.length) return [];

  const booked = await prisma.appointment.findMany({
    where: {
      doctorId: doctor.id,
      date,
      type: 'SLOT',
      status: { in: ['BOOKED', 'ARRIVED', 'IN_PROGRESS', 'DONE'] },
      slotStart: { not: null },
    },
    select: { slotStart: true },
  });

  const takenMs = new Set(booked.map((b) => b.slotStart!.getTime()));

  return candidates.filter((s) => !takenMs.has(s.start.getTime()) && s.start.getTime() > now.getTime());
}

export type BookSlotResult =
  | { ok: true; appointment: Appointment; alreadyExisted?: boolean }
  | { ok: false; reason: 'ON_LEAVE' | 'NOT_A_SLOT' | 'IN_PAST' | 'TAKEN' }
  /**
   * They hold an appointment that day already, and asked for a *different*
   * time. Carries the existing one so the caller can offer to move it rather
   * than making them cancel and start again — which is two steps with a gap the
   * wanted slot can disappear into.
   */
  | { ok: false; reason: 'PATIENT_HAS_SLOT'; existing: Appointment };

/**
 * Book a specific time. The counterpart to issueToken, with the same
 * guarantees.
 *
 * Race safety comes from the @@unique([doctorId, slotStart]) constraint rather
 * than from checking first: two people at the desk can submit the same slot in
 * the same instant, and a read-then-write would let both through. The insert is
 * the check — a duplicate raises P2002 and becomes TAKEN.
 *
 * The requested time must be one generate_slots would produce, so a crafted
 * form cannot book 03:00 or a time that straddles two real slots.
 */
export async function bookSlot(
  doctor: Doctor,
  patientId: string,
  date: Date,
  slotStart: Date,
  now: Date = new Date(),
): Promise<BookSlotResult> {
  if (isOnLeave(doctor, date)) return { ok: false, reason: 'ON_LEAVE' };

  const slot = generateSlots(doctor, date).find(
    (s) => s.start.getTime() === slotStart.getTime(),
  );
  if (!slot) return { ok: false, reason: 'NOT_A_SLOT' };
  if (slot.start.getTime() <= now.getTime()) return { ok: false, reason: 'IN_PAST' };

  // One appointment per patient per day, matching the token rule. Which of the
  // two things it is depends on the time they asked for, and they want opposite
  // answers: re-tapping the slot they already hold is a double submit and must
  // be idempotent; asking for a different time is a deliberate change and
  // deserves to be offered as a move.
  const existing = await prisma.appointment.findFirst({
    where: {
      doctorId: doctor.id,
      patientId,
      date,
      type: 'SLOT',
      status: { in: ['BOOKED', 'ARRIVED', 'IN_PROGRESS'] },
    },
  });
  if (existing) {
    const sameSlot = existing.slotStart?.getTime() === slot.start.getTime();
    return sameSlot
      ? { ok: true, appointment: existing, alreadyExisted: true }
      : { ok: false, reason: 'PATIENT_HAS_SLOT', existing };
  }

  try {
    const appointment = await prisma.appointment.create({
      data: {
        doctorId: doctor.id,
        patientId,
        date,
        type: 'SLOT',
        status: 'BOOKED',
        slotStart: slot.start,
        slotEnd: slot.end,
      },
    });
    return { ok: true, appointment };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return { ok: false, reason: 'TAKEN' };
    }
    throw err;
  }
}

/**
 * Move an existing appointment to a different time.
 *
 * Both writes in one transaction, and in this order: take the new slot first,
 * release the old one second. If the new slot went while the patient was
 * deciding, the insert raises P2002, the transaction rolls back, and **the
 * original appointment is still theirs**.
 *
 * That ordering is the whole point. Cancelling first — which is what the bot
 * used to tell patients to do by hand — opens a window where they hold nothing,
 * and the slot they were reaching for can be taken inside it. Ending up with
 * neither is worse than either outcome on its own.
 */
export async function moveSlot(
  doctor: Doctor,
  patientId: string,
  existingId: string,
  date: Date,
  slotStart: Date,
  now: Date = new Date(),
): Promise<BookSlotResult> {
  if (isOnLeave(doctor, date)) return { ok: false, reason: 'ON_LEAVE' };

  const slot = generateSlots(doctor, date).find(
    (s) => s.start.getTime() === slotStart.getTime(),
  );
  if (!slot) return { ok: false, reason: 'NOT_A_SLOT' };
  if (slot.start.getTime() <= now.getTime()) return { ok: false, reason: 'IN_PAST' };

  try {
    const appointment = await prisma.$transaction(async (tx) => {
      const created = await tx.appointment.create({
        data: {
          doctorId: doctor.id,
          patientId,
          date,
          type: 'SLOT',
          status: 'BOOKED',
          slotStart: slot.start,
          slotEnd: slot.end,
        },
      });

      // Scoped to this patient and to a still-active status, so a stale id from
      // an old session cannot cancel somebody else's appointment.
      await tx.appointment.updateMany({
        where: {
          id: existingId,
          patientId,
          doctorId: doctor.id,
          status: { in: ['BOOKED', 'ARRIVED', 'IN_PROGRESS'] },
        },
        data: { status: 'CANCELLED', cancelledAt: now },
      });

      return created;
    });

    return { ok: true, appointment };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, reason: 'TAKEN' };
    }
    throw err;
  }
}

/** Every slot for a day with who holds it — the calendar's data. */
export interface CalendarSlot {
  start: Date;
  end: Date;
  appointment: (Appointment & { patient: { id: string; name: string | null; phone: string } }) | null;
  isPast: boolean;
}

export async function getDaySchedule(
  doctor: Doctor,
  date: Date,
  now: Date = new Date(),
): Promise<CalendarSlot[]> {
  const slots = generateSlots(doctor, date);

  const booked = await prisma.appointment.findMany({
    where: { doctorId: doctor.id, date, type: 'SLOT', slotStart: { not: null } },
    include: { patient: { select: { id: true, name: true, phone: true } } },
  });

  // Cancelled slots free up again, so the latest non-cancelled row wins.
  const byStart = new Map<number, (typeof booked)[number]>();
  for (const a of booked) {
    if (a.status === 'CANCELLED') continue;
    byStart.set(a.slotStart!.getTime(), a);
  }

  return slots.map((s) => ({
    start: s.start,
    end: s.end,
    appointment: byStart.get(s.start.getTime()) ?? null,
    isPast: s.start.getTime() <= now.getTime(),
  }));
}

/** Next N dates (from `from`, inclusive) that have at least one free slot. */
export async function getNextAvailableDates(
  doctor: Doctor,
  from: Date,
  count = 5,
  lookAheadDays = 21,
): Promise<Date[]> {
  const out: Date[] = [];
  let cursor = DateTime.fromJSDate(from, { zone: 'utc' });

  for (let i = 0; i < lookAheadDays && out.length < count; i += 1) {
    const date = cursor.toJSDate();
    const slots = await getAvailableSlots(doctor, date);
    if (slots.length) out.push(date);
    cursor = cursor.plus({ days: 1 });
  }

  return out;
}

/** 6 PM the evening before, in the doctor's timezone. */
export function dayBeforeReminderAt(date: Date, timezone: string): Date | null {
  const dayBefore = DateTime.fromJSDate(date, { zone: 'utc' }).minus({ days: 1 }).toJSDate();
  return atLocalTime(dayBefore, '18:00', timezone);
}

/** One hour before the slot starts. */
export function hourBeforeReminderAt(slotStart: Date): Date {
  return new Date(slotStart.getTime() - 60 * 60_000);
}

export function slotLabel(slot: Slot, timezone: string): string {
  return DateTime.fromJSDate(slot.start).setZone(timezone).toFormat('hh:mm a');
}

export function dateKey(date: Date): string {
  return formatDateOnly(date);
}
