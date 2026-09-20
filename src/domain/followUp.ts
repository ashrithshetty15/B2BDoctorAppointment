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

/**
 * The payload carried by the reminder's "Book appointment" button.
 *
 * A template's quick-reply button sends back whatever payload was supplied at
 * send time, so the tap can say *which* follow-up it answers. That is what
 * makes it one tap at a clinic with more than one doctor: without it the bot
 * would reply "which doctor would you like to see?" to a message the patient
 * received from a named doctor, and could book them with the wrong one.
 */
const PAYLOAD_PREFIX = 'FU:';

export function followUpPayload(appointmentId: string): string {
  return `${PAYLOAD_PREFIX}${appointmentId}`;
}

/** The appointment id inside a tap, or null if this is ordinary text. */
export function parseFollowUpPayload(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith(PAYLOAD_PREFIX)) return null;
  const id = trimmed.slice(PAYLOAD_PREFIX.length).trim();
  return id.length > 0 ? id : null;
}

/**
 * The doctor a follow-up tap should book with.
 *
 * Scoped by patient, which is the whole security story: the payload reaches us
 * as inbound text and a patient can type anything, so a guessed or copied
 * appointment id must not select someone else's doctor or leak that the
 * appointment exists. Narrowing the query by patientId makes a wrong id
 * indistinguishable from a missing one — it simply returns null and the
 * message is handled as ordinary text.
 */
export async function doctorForFollowUpTap(
  appointmentId: string,
  patientId: string,
  doctors: { id: string }[],
): Promise<string | null> {
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, patientId },
    select: { doctorId: true },
  });
  if (!appointment) return null;

  // Still has to be a doctor the clinic offers today. One who has left is not
  // bookable, and silently honouring the tap would park the patient on a flow
  // with nobody behind it.
  return doctors.some((d) => d.id === appointment.doctorId) ? appointment.doctorId : null;
}

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

/**
 * Record that the patient tapped the reminder's button.
 *
 * Stamped once. A patient who taps the same reminder twice — easy to do, the
 * message stays in their chat forever — is one person answering one reminder,
 * and counting it twice would inflate the only number a doctor is asked to
 * trust.
 */
export async function markFollowUpTapped(appointmentId: string, at: Date): Promise<void> {
  await prisma.appointment.updateMany({
    where: { id: appointmentId, followUpTappedAt: null },
    data: { followUpTappedAt: at },
  });
}

export interface FollowUpFunnel {
  /** Reminders actually delivered to a patient in the window. */
  sent: number;
  /** Of those, the ones whose button was tapped. */
  tapped: number;
  /** Of those, the ones that became a booking that still stands. */
  booked: number;
  since: Date;
}

/**
 * Did the reminders work?
 *
 * Three numbers, narrowing: sent, tapped, booked. The clinic is being asked to
 * believe that a follow-up reminder brings patients back, and until now nothing
 * here could tell them whether it had.
 *
 * A booking counts when the same patient books with the same doctor *after*
 * tapping, and that booking has not been cancelled. Two deliberate choices in
 * that sentence:
 *
 * - The tap is what attribution hangs on, because it names the visit that
 *   caused it. A patient who gets the reminder and telephones instead is not
 *   counted, and that is the right way to be wrong: the number under-claims
 *   rather than over-claims, so a doctor checking it against their own day
 *   finds it modest rather than inflated.
 * - Cancelled bookings are excluded, because this figure gets multiplied by a
 *   consult fee and a cancelled visit earns nothing.
 * - And the booking has to follow the tap reasonably closely. Unbounded, a tap
 *   in September and a booking in December counted as a conversion, which is
 *   not a claim that survives a doctor asking how we know.
 */
const ATTRIBUTION_DAYS = 30;
const ATTRIBUTION_MS = ATTRIBUTION_DAYS * 86_400_000;
export async function followUpFunnel(doctorId: string, since: Date): Promise<FollowUpFunnel> {
  const sentRows = await prisma.appointment.findMany({
    where: { doctorId, followUpSentAt: { gte: since } },
    select: { id: true, patientId: true, followUpTappedAt: true },
  });

  const tappedRows = sentRows.filter(
    (r): r is typeof r & { followUpTappedAt: Date } => r.followUpTappedAt !== null,
  );

  if (tappedRows.length === 0) {
    return { sent: sentRows.length, tapped: 0, booked: 0, since };
  }

  // One query for every candidate booking, rather than one per follow-up.
  const earliestTap = tappedRows.reduce(
    (min, r) => (r.followUpTappedAt < min ? r.followUpTappedAt : min),
    tappedRows[0]!.followUpTappedAt,
  );

  const latestTap = tappedRows.reduce(
    (max, r) => (r.followUpTappedAt > max ? r.followUpTappedAt : max),
    tappedRows[0]!.followUpTappedAt,
  );

  const candidates = await prisma.appointment.findMany({
    where: {
      doctorId,
      patientId: { in: [...new Set(tappedRows.map((r) => r.patientId))] },
      // Bounded at both ends, so the database returns only rows that could
      // possibly attribute to some tap rather than every booking since.
      createdAt: { gte: earliestTap, lte: new Date(latestTap.getTime() + ATTRIBUTION_MS) },
      status: { notIn: ['CANCELLED'] },
    },
    select: { id: true, patientId: true, createdAt: true },
  });

  const booked = tappedRows.filter((r) => {
    const tappedAt = r.followUpTappedAt.getTime();
    return candidates.some(
      (c) =>
        c.patientId === r.patientId &&
        c.id !== r.id &&
        c.createdAt.getTime() >= tappedAt &&
        c.createdAt.getTime() <= tappedAt + ATTRIBUTION_MS,
    );
  }).length;

  return { sent: sentRows.length, tapped: tappedRows.length, booked, since };
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
