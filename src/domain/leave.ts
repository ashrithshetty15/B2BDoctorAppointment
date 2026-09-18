import type { Doctor } from '@prisma/client';
import { prisma } from '../db/prisma';
import type { DoctorWithChannel } from './doctors';
import { formatDateOnly } from '../utils/time';
import { getOrCreateQueueState, isOnLeave } from './tokenQueue';
import {
  type Reachability,
  type WithPatient,
  cancelBookings,
  loadDayBookings,
  splitByReachability,
} from './cancellation';

/**
 * Closing a day: the doctor has an emergency, or is away at a conference.
 *
 * Both are the same operation on a different date — mark the day as leave so
 * nothing new can be booked into it, stop the token counter, cancel what is
 * already booked, and tell those patients.
 *
 * Only still-standing bookings are touched, so walking out at 3pm leaves the
 * morning's completed consults alone: this cancels the *remaining* day.
 *
 * The cancelling itself lives in domain/cancellation.ts, shared with cancelling
 * a handful of patients by hand.
 */

export type { WithPatient } from './cancellation';
export { MESSAGING_WINDOW_HOURS, isReachable } from './cancellation';

export interface DayClosurePreview extends Reachability {
  /** Everything that would be cancelled, soonest first. */
  affected: WithPatient[];
  alreadyClosed: boolean;
}

/**
 * What closing this day would do, without doing any of it. Drives the
 * confirmation screen: the doctor sees the real cost before committing,
 * including who will not hear about it.
 */
export async function previewDayClosure(
  doctor: DoctorWithChannel,
  date: Date,
  now: Date = new Date(),
): Promise<DayClosurePreview> {
  const affected = await loadDayBookings(doctor.id, date);
  return {
    affected,
    ...(await splitByReachability(doctor.id, affected, now)),
    alreadyClosed: isOnLeave(doctor, date),
  };
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
  /** Queued, not delivered — see CancellationResult. */
  messagesQueued: number;
  /** Patients the doctor needs to phone, because we expect the send to fail. */
  unreachable: WithPatient[];
}

export async function closeDay(
  doctor: DoctorWithChannel,
  date: Date,
  now: Date = new Date(),
): Promise<DayClosureResult> {
  const { affected, unreachable } = await previewDayClosure(doctor, date, now);

  await markDayClosed(doctor, date);
  const { cancelled, messagesQueued } = await cancelBookings(doctor, affected, now);

  return { cancelled, messagesQueued, unreachable };
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
