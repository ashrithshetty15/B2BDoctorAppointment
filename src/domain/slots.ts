import type { Doctor } from '@prisma/client';
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

const DAY_KEYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

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
