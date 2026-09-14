import type { Doctor } from '@prisma/client';
import { DateTime } from 'luxon';
import { prisma } from '../db/prisma';
import { formatDateOnly } from '../utils/time';

/**
 * Follow-ups: "come back in two weeks."
 *
 * Decided by the doctor during the consult and attached to that appointment, so
 * the reason stays next to the visit and its remark rather than floating on the
 * patient.
 *
 * The hard constraint is delivery. A follow-up is by definition due days or
 * weeks after the visit, which is *always* outside WhatsApp's 24-hour free-form
 * window — not sometimes, always. So unlike every other message in this codebase
 * it can only ever go out as an approved template. Until one is configured, due
 * follow-ups stay pending and are listed in the console for the desk to phone.
 * Nothing is attempted and silently dropped.
 */

/** Offsets offered as one-tap chips; anything else uses the date field. */
export const FOLLOW_UP_PRESETS = [
  { key: '1w', days: 7 },
  { key: '2w', days: 14 },
  { key: '1m', days: 30 },
  { key: '3m', days: 90 },
] as const;

export type FollowUpPreset = (typeof FOLLOW_UP_PRESETS)[number]['key'];

export function presetDays(key: string): number | null {
  return FOLLOW_UP_PRESETS.find((p) => p.key === key)?.days ?? null;
}

/**
 * `from` is a @db.Date at UTC midnight, and the result must be one too, so the
 * arithmetic stays in UTC rather than drifting a day through a timezone.
 */
export function addDays(from: Date, days: number): Date {
  return DateTime.fromJSDate(from, { zone: 'utc' }).plus({ days }).toJSDate();
}

export interface FollowUpRow {
  appointmentId: string;
  patientId: string;
  patientName: string | null;
  patientPhone: string;
  /** The visit that decided it. */
  visitedOn: Date;
  dueOn: Date;
  sentAt: Date | null;
  notes: string | null;
}

function toRow(a: {
  id: string;
  date: Date;
  followUpOn: Date | null;
  followUpSentAt: Date | null;
  notes: string | null;
  patient: { id: string; name: string | null; phone: string };
}): FollowUpRow {
  return {
    appointmentId: a.id,
    patientId: a.patient.id,
    patientName: a.patient.name,
    patientPhone: a.patient.phone,
    visitedOn: a.date,
    dueOn: a.followUpOn!,
    sentAt: a.followUpSentAt,
    notes: a.notes,
  };
}

const SELECT = {
  id: true,
  date: true,
  followUpOn: true,
  followUpSentAt: true,
  notes: true,
  patient: { select: { id: true, name: true, phone: true } },
} as const;

/**
 * Set or move a follow-up. Scoped by doctorId, so an appointment id from another
 * clinic is simply not found.
 */
export async function setFollowUp(
  doctorId: string,
  appointmentId: string,
  dueOn: Date,
): Promise<boolean> {
  const { count } = await prisma.appointment.updateMany({
    where: { id: appointmentId, doctorId },
    // Moving the date clears any previous send, so a rescheduled follow-up is
    // announced again rather than being treated as already handled.
    data: { followUpOn: dueOn, followUpSentAt: null },
  });
  return count > 0;
}

export async function clearFollowUp(doctorId: string, appointmentId: string): Promise<boolean> {
  const { count } = await prisma.appointment.updateMany({
    where: { id: appointmentId, doctorId },
    data: { followUpOn: null, followUpSentAt: null },
  });
  return count > 0;
}

/** Due today or overdue and not yet sent — the desk's worklist. */
export async function dueFollowUps(doctorId: string, today: Date): Promise<FollowUpRow[]> {
  const rows = await prisma.appointment.findMany({
    where: { doctorId, followUpOn: { lte: today }, followUpSentAt: null },
    select: SELECT,
    orderBy: { followUpOn: 'asc' },
    take: 200,
  });
  return rows.map(toRow);
}

/** Still in the future — visible so the clinic can see what is coming. */
export async function upcomingFollowUps(doctorId: string, today: Date): Promise<FollowUpRow[]> {
  const rows = await prisma.appointment.findMany({
    where: { doctorId, followUpOn: { gt: today } },
    select: SELECT,
    orderBy: { followUpOn: 'asc' },
    take: 200,
  });
  return rows.map(toRow);
}

/** The follow-up currently attached to one visit, if any. */
export async function followUpFor(
  doctorId: string,
  appointmentId: string,
): Promise<{ dueOn: Date; sentAt: Date | null } | null> {
  const a = await prisma.appointment.findFirst({
    where: { id: appointmentId, doctorId },
    select: { followUpOn: true, followUpSentAt: true },
  });
  if (!a?.followUpOn) return null;
  return { dueOn: a.followUpOn, sentAt: a.followUpSentAt };
}

/** Human "in 2 weeks" style label for a chip. */
export function presetLabel(key: FollowUpPreset, language: 'EN' | 'KN'): string {
  const en: Record<FollowUpPreset, string> = {
    '1w': '1 week',
    '2w': '2 weeks',
    '1m': '1 month',
    '3m': '3 months',
  };
  const kn: Record<FollowUpPreset, string> = {
    '1w': '1 ವಾರ',
    '2w': '2 ವಾರ',
    '1m': '1 ತಿಂಗಳು',
    '3m': '3 ತಿಂಗಳು',
  };
  return language === 'KN' ? kn[key] : en[key];
}

/** True when a date is today or earlier, compared as calendar days. */
export function isDue(dueOn: Date, today: Date): boolean {
  return formatDateOnly(dueOn) <= formatDateOnly(today);
}

/** Counts for the console badge, in one round trip. */
export async function followUpCounts(
  doctor: Doctor,
  today: Date,
): Promise<{ due: number; upcoming: number }> {
  const [due, upcoming] = await Promise.all([
    prisma.appointment.count({
      where: { doctorId: doctor.id, followUpOn: { lte: today }, followUpSentAt: null },
    }),
    prisma.appointment.count({ where: { doctorId: doctor.id, followUpOn: { gt: today } } }),
  ]);
  return { due, upcoming };
}
