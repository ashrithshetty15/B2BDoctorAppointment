import type { Appointment, Doctor, Patient } from '@prisma/client';
import { prisma } from '../db/prisma';
import { cancelReminders } from '../queue/queues';
import { notifyCancelledByClinic } from '../services/notifications';
import { formatDateOnly } from '../utils/time';
import { ACTIVE_TOKEN_STATUSES } from './tokenQueue';

/**
 * Cancelling bookings the clinic can no longer honour.
 *
 * Shared by the two ways that happens: closing a whole day (domain/leave.ts) and
 * picking a few patients off today's queue. Both have to do the same four things
 * — flip the rows, fix the now-serving pointer, kill the reminders, tell the
 * patients — and both have to be honest about who cannot be told.
 */

export type WithPatient = Appointment & { patient: Patient };

/**
 * How long WhatsApp lets us send a free-form message after the patient's last
 * inbound one. Outside it Meta rejects the send, and our adapter cannot tell that
 * apart from a transient failure, so we work it out in advance instead.
 */
export const MESSAGING_WINDOW_HOURS = 24;

export function isReachable(lastInboundAt: Date | null | undefined, now: Date): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() < MESSAGING_WINDOW_HOURS * 3_600_000;
}

export interface Reachability {
  /** Patients we can message right now. */
  reachable: WithPatient[];
  /**
   * Outside the messaging window, or never messaged this clinic at all (every
   * desk walk-in). Somebody has to phone these.
   */
  unreachable: WithPatient[];
}

/**
 * When each of these patients last messaged **this** clinic.
 *
 * Scoped to the doctor on purpose: the window belongs to the business number the
 * patient wrote to, so a patient who messages Clinic A is not reachable by Clinic
 * B. Returning a Map keeps the partition below a pure function.
 */
export async function loadMessagingWindows(
  doctorId: string,
  patientIds: string[],
): Promise<Map<string, Date>> {
  if (patientIds.length === 0) return new Map();
  const rows = await prisma.messagingWindow.findMany({
    where: { doctorId, patientId: { in: patientIds } },
    select: { patientId: true, lastInboundAt: true },
  });
  return new Map(rows.map((r) => [r.patientId, r.lastInboundAt]));
}

export function partitionByReachability(
  appointments: WithPatient[],
  windows: Map<string, Date>,
  now: Date = new Date(),
): Reachability {
  const reachable: WithPatient[] = [];
  const unreachable: WithPatient[] = [];
  for (const appointment of appointments) {
    const lastInboundAt = windows.get(appointment.patientId);
    (isReachable(lastInboundAt, now) ? reachable : unreachable).push(appointment);
  }
  return { reachable, unreachable };
}

/** Load the windows and split in one step — what every caller actually wants. */
export async function splitByReachability(
  doctorId: string,
  appointments: WithPatient[],
  now: Date = new Date(),
): Promise<Reachability> {
  const windows = await loadMessagingWindows(
    doctorId,
    appointments.map((a) => a.patientId),
  );
  return partitionByReachability(appointments, windows, now);
}

/** Only a booking that is still standing can be cancelled. */
export function activeWhere(doctorId: string, date?: Date) {
  return {
    doctorId,
    ...(date ? { date } : {}),
    status: { in: [...ACTIVE_TOKEN_STATUSES] },
  };
}

/** Every still-standing booking on a day. */
export async function loadDayBookings(doctorId: string, date: Date): Promise<WithPatient[]> {
  return prisma.appointment.findMany({
    where: activeWhere(doctorId, date),
    include: { patient: true },
    orderBy: [{ slotStart: 'asc' }, { tokenNumber: 'asc' }],
  });
}

/**
 * Named bookings, scoped to this doctor.
 *
 * The doctorId filter is the whole authorisation check: ids arrive from a form
 * and a crafted one must simply not be found rather than cancel another clinic's
 * patient.
 */
export async function loadBookingsByIds(
  doctorId: string,
  ids: string[],
): Promise<WithPatient[]> {
  if (ids.length === 0) return [];
  return prisma.appointment.findMany({
    where: { ...activeWhere(doctorId), id: { in: ids } },
    include: { patient: true },
    orderBy: [{ slotStart: 'asc' }, { tokenNumber: 'asc' }],
  });
}

export interface CancellationResult {
  cancelled: number;
  /**
   * Messages handed to the queue — deliberately not "notified". We send to
   * everyone, including patients predicted to be outside the window, because the
   * prediction can be wrong in our favour. What we must not do is report those as
   * told; `unreachable` from the preview is the honest number.
   */
  messagesQueued: number;
}

/**
 * Cancel the given bookings and tell the patients.
 *
 * Caller supplies the rows because it has usually already loaded them to show a
 * confirmation, and because once the status flips they no longer match the
 * active filter.
 */
export async function cancelBookings(
  doctor: Doctor,
  appointments: WithPatient[],
  now: Date = new Date(),
): Promise<CancellationResult> {
  if (appointments.length === 0) return { cancelled: 0, messagesQueued: 0 };

  const ids = appointments.map((a) => a.id);

  // One statement rather than a row-at-a-time loop: a failure partway through
  // used to leave some patients cancelled and the rest still expecting a doctor.
  const { count } = await prisma.appointment.updateMany({
    where: { id: { in: ids }, doctorId: doctor.id },
    data: { status: 'CANCELLED', cancelledAt: now },
  });

  await clearNowServing(doctor.id, appointments);

  // BullMQ jobs, so there is no bulk equivalent. A failure here only means a
  // reminder fires for a cancelled appointment, which must not cost us the
  // cancellation itself.
  await Promise.all(ids.map((id) => cancelReminders(id).catch(() => undefined)));

  const { notified } = await notifyCancelledByClinic(doctor, appointments);
  return { cancelled: count, messagesQueued: notified };
}

/**
 * If a cancelled token was the one in the room, the queue would otherwise keep
 * pointing at it forever — applyStatusChange is the only other writer and it
 * never runs for a cancellation.
 *
 * Matched on the specific token rather than blanket-cleared: after a DONE the
 * pointer legitimately still names that patient, and clearing it because some
 * *other* booking was cancelled would lose that.
 */
async function clearNowServing(doctorId: string, appointments: WithPatient[]): Promise<void> {
  const byDate = new Map<string, { date: Date; tokens: number[] }>();
  for (const a of appointments) {
    if (a.tokenNumber === null) continue;
    const key = formatDateOnly(a.date);
    const entry = byDate.get(key) ?? { date: a.date, tokens: [] };
    entry.tokens.push(a.tokenNumber);
    byDate.set(key, entry);
  }

  for (const { date, tokens } of byDate.values()) {
    await prisma.queueState.updateMany({
      where: { doctorId, date, nowServingToken: { in: tokens } },
      data: { nowServingToken: null },
    });
  }
}
