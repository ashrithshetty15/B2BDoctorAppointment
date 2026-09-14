import type { Appointment, Doctor, Patient } from '@prisma/client';
import { prisma } from '../db/prisma';
import { cancelReminders } from '../queue/queues';
import { notifyCancelledByClinic } from '../services/notifications';
import { formatDateOnly } from '../utils/time';
import { ACTIVE_TOKEN_STATUSES, getOrCreateQueueState, isOnLeave } from './tokenQueue';

/**
 * Closing a day: the doctor has an emergency, or is away at a conference.
 *
 * Both are the same operation on a different date — mark the day as leave so
 * nothing new can be booked into it, stop the token counter, cancel what is
 * already booked, and tell those patients.
 *
 * This was previously inline in the JSON leave route. It lives here so the
 * console and the API cannot drift, and so the three things that route got wrong
 * are fixed in one place rather than twice.
 */

export type WithPatient = Appointment & { patient: Patient };

/**
 * How long WhatsApp lets us send a free-form message after the patient's last
 * inbound one. Outside it, Meta rejects the send and our adapter cannot tell that
 * apart from a transient failure — so we work it out in advance instead.
 */
export const MESSAGING_WINDOW_HOURS = 24;

export function isReachable(patient: Pick<Patient, 'lastInboundAt'>, now: Date): boolean {
  if (!patient.lastInboundAt) return false;
  return now.getTime() - patient.lastInboundAt.getTime() < MESSAGING_WINDOW_HOURS * 3_600_000;
}

export interface DayClosurePreview {
  /** Everything that would be cancelled, soonest first. */
  affected: WithPatient[];
  /** Patients we can message right now. */
  reachable: WithPatient[];
  /**
   * Patients outside the messaging window, or who have never messaged us at all
   * (every desk walk-in). Somebody has to phone these.
   */
  unreachable: WithPatient[];
  alreadyClosed: boolean;
}

function activeOn(doctorId: string, date: Date) {
  return {
    doctorId,
    date,
    status: { in: [...ACTIVE_TOKEN_STATUSES] },
  };
}

/**
 * What closing this day would do, without doing any of it. Drives the
 * confirmation screen: the doctor sees the real cost before committing, including
 * who will not hear about it.
 */
export async function previewDayClosure(
  doctor: Doctor,
  date: Date,
  now: Date = new Date(),
): Promise<DayClosurePreview> {
  const affected = await prisma.appointment.findMany({
    where: activeOn(doctor.id, date),
    include: { patient: true },
    orderBy: [{ slotStart: 'asc' }, { tokenNumber: 'asc' }],
  });

  const reachable: WithPatient[] = [];
  const unreachable: WithPatient[] = [];
  for (const appointment of affected) {
    (isReachable(appointment.patient, now) ? reachable : unreachable).push(appointment);
  }

  return { affected, reachable, unreachable, alreadyClosed: isOnLeave(doctor, date) };
}

/**
 * Mark the day unavailable without touching existing bookings.
 *
 * Two independent gates stop new ones: isOnLeave short-circuits issueToken and
 * generateSlots, and isClosed is checked inside the atomic token claim.
 */
export async function markDayClosed(doctor: Doctor, date: Date): Promise<void> {
  if (!isOnLeave(doctor, date)) {
    await prisma.doctor.update({
      where: { id: doctor.id },
      data: { leaveDates: { push: date } },
    });
  }

  await getOrCreateQueueState(doctor.id, date);
  await prisma.queueState.update({
    where: { doctor_date: { doctorId: doctor.id, date } },
    data: { isClosed: true },
  });
}

export interface DayClosureResult {
  cancelled: number;
  /**
   * Messages handed to the queue — deliberately not called "notified". We send to
   * everyone, including patients we predict are outside the window, because the
   * prediction can be wrong in our favour (a missed lastInboundAt stamp). What we
   * must not do is report those as told. `unreachable` is the honest number.
   */
  messagesQueued: number;
  /** Patients the doctor needs to phone, because we expect the send to fail. */
  unreachable: WithPatient[];
}

/**
 * Close a day and cancel everything booked into it.
 *
 * Reads the appointments before cancelling because the patient rows are needed to
 * notify, and once the status flips they no longer match the active filter.
 */
export async function closeDay(
  doctor: Doctor,
  date: Date,
  now: Date = new Date(),
): Promise<DayClosureResult> {
  const { affected, unreachable } = await previewDayClosure(doctor, date, now);

  await markDayClosed(doctor, date);

  // One statement rather than a row-at-a-time loop: a failure partway through
  // used to leave half a day cancelled, with the rest still expecting a doctor.
  const { count } = await prisma.appointment.updateMany({
    where: activeOn(doctor.id, date),
    data: { status: 'CANCELLED', cancelledAt: now },
  });

  // If the patient in the room was just cancelled, the queue would otherwise keep
  // pointing at their token forever — applyStatusChange is the only other writer
  // and it never runs for a cancellation.
  await prisma.queueState.updateMany({
    where: { doctorId: doctor.id, date, nowServingToken: { not: null } },
    data: { nowServingToken: null },
  });

  // BullMQ jobs, so no bulk equivalent. A failure here would only mean a reminder
  // fires for a cancelled appointment, which must not cost us the cancellation.
  await Promise.all(
    affected.map((appointment) =>
      cancelReminders(appointment.id).catch(() => undefined),
    ),
  );

  const { notified } = await notifyCancelledByClinic(doctor, affected);
  return { cancelled: count, messagesQueued: notified, unreachable };
}

/**
 * Undo the closure — the emergency passed, or the day was closed by mistake.
 *
 * Only reopens the day to new bookings. Cancelled appointments stay cancelled:
 * those patients have already been told not to come, so silently reinstating them
 * would put people in a queue they believe they are not in. The UI has to say so.
 */
export async function reopenDay(doctor: Doctor, date: Date): Promise<void> {
  const key = formatDateOnly(date);
  await prisma.doctor.update({
    where: { id: doctor.id },
    // leaveDates is a scalar list, so there is no per-element delete — filter and
    // write the whole array back.
    data: { leaveDates: { set: doctor.leaveDates.filter((d) => formatDateOnly(d) !== key) } },
  });

  await prisma.queueState.updateMany({
    where: { doctorId: doctor.id, date },
    data: { isClosed: false },
  });
}

/** Upcoming leave, soonest first — what the settings page lists. */
export function upcomingLeave(doctor: Doctor, today: Date): Date[] {
  const from = formatDateOnly(today);
  return doctor.leaveDates
    .filter((d) => formatDateOnly(d) >= from)
    .sort((a, b) => a.getTime() - b.getTime());
}
