import { Prisma, type Appointment, type Doctor, type QueueState } from '@prisma/client';
import { prisma } from '../db/prisma';
import { formatDateOnly } from '../utils/time';

/**
 * Token queue engine (requirement 4).
 *
 * Design notes:
 * - Token numbers are monotonic per (doctor, date) and are NOT recycled when a
 *   patient cancels — patients hold a printed/messaged number and reusing it
 *   would be confusing. `daily_token_cap` therefore caps tokens *issued*.
 * - Assignment is a single atomic UPDATE ... RETURNING with the cap in the
 *   WHERE clause, so two patients booking in the same millisecond cannot get
 *   the same number or exceed the cap.
 */

/** Statuses that still occupy a place in the queue. */
export const ACTIVE_TOKEN_STATUSES = ['BOOKED', 'ARRIVED', 'IN_PROGRESS'] as const;

/** How many recent consults the rolling average effectively remembers. */
const ROLLING_WINDOW = 20;

export type IssueTokenResult =
  | { ok: true; appointment: Appointment; alreadyExisted: boolean }
  | { ok: false; reason: 'CAP_REACHED' | 'LIST_CLOSED' | 'ON_LEAVE' };

export interface QueuePosition {
  tokenNumber: number;
  /** Active tokens with a lower number than this one. */
  ahead: number;
  /** ahead * avgConsultTimeMins + announced delay. */
  etaMins: number;
  nowServingToken: number | null;
}

export async function getOrCreateQueueState(doctorId: string, date: Date): Promise<QueueState> {
  return prisma.queueState.upsert({
    where: { doctor_date: { doctorId, date } },
    create: { doctorId, date },
    update: {},
  });
}

/** The patient's live token for a date, if any. */
export async function findActiveToken(
  doctorId: string,
  patientId: string,
  date: Date,
): Promise<Appointment | null> {
  return prisma.appointment.findFirst({
    where: {
      doctorId,
      patientId,
      date,
      type: 'TOKEN',
      status: { in: [...ACTIVE_TOKEN_STATUSES] },
    },
    orderBy: { tokenNumber: 'asc' },
  });
}

export function isOnLeave(doctor: Pick<Doctor, 'leaveDates'>, date: Date): boolean {
  return doctor.leaveDates.some((d) => formatDateOnly(d) === formatDateOnly(date));
}

/**
 * Assign the next sequential token for (doctor, date), respecting daily_token_cap.
 * Idempotent per patient: an existing active token is returned untouched.
 */
export async function issueToken(
  doctor: Doctor,
  patientId: string,
  date: Date,
): Promise<IssueTokenResult> {
  if (isOnLeave(doctor, date)) return { ok: false, reason: 'ON_LEAVE' };

  const existing = await findActiveToken(doctor.id, patientId, date);
  if (existing) return { ok: true, appointment: existing, alreadyExisted: true };

  await getOrCreateQueueState(doctor.id, date);

  return prisma.$transaction(async (tx) => {
    // Atomic claim: increments only if the list is open and the cap allows it.
    // The row lock taken here also serialises concurrent bookings.
    // Ids are TEXT columns (Prisma String), and the date is passed as an
    // unambiguous YYYY-MM-DD literal so no session timezone can shift it.
    const claimed = await tx.$queryRaw<Array<{ last_issued_token: number }>>(
      Prisma.sql`
        UPDATE queue_states
           SET last_issued_token = last_issued_token + 1,
               updated_at = now()
         WHERE doctor_id = ${doctor.id}
           AND date = ${formatDateOnly(date)}::date
           AND is_closed = false
           AND last_issued_token < ${doctor.dailyTokenCap}
        RETURNING last_issued_token
      `,
    );

    const tokenNumber = claimed[0]?.last_issued_token;
    if (tokenNumber === undefined) {
      // Either closed or at cap — distinguish for the patient-facing message.
      const state = await tx.queueState.findUnique({
        where: { doctor_date: { doctorId: doctor.id, date } },
      });
      return {
        ok: false as const,
        reason: state?.isClosed ? ('LIST_CLOSED' as const) : ('CAP_REACHED' as const),
      };
    }

    const appointment = await tx.appointment.create({
      data: {
        doctorId: doctor.id,
        patientId,
        date,
        type: 'TOKEN',
        status: 'BOOKED',
        tokenNumber,
      },
    });

    return { ok: true as const, appointment, alreadyExisted: false };
  });
}

/** Every active token for the day, lowest number first. */
export async function getActiveTokens(doctorId: string, date: Date): Promise<Appointment[]> {
  return prisma.appointment.findMany({
    where: {
      doctorId,
      date,
      type: 'TOKEN',
      status: { in: [...ACTIVE_TOKEN_STATUSES] },
    },
    orderBy: { tokenNumber: 'asc' },
  });
}

/**
 * Position + ETA for one token. `activeTokens` and `queueState` can be passed in
 * when computing positions for the whole queue, to avoid N queries.
 */
export async function computePosition(
  appointment: Appointment,
  doctor: Pick<Doctor, 'id' | 'avgConsultTimeMins'>,
  opts?: { activeTokens?: Appointment[]; queueState?: QueueState | null },
): Promise<QueuePosition> {
  const tokenNumber = appointment.tokenNumber ?? 0;

  const activeTokens =
    opts?.activeTokens ?? (await getActiveTokens(doctor.id, appointment.date));
  const queueState =
    opts?.queueState !== undefined
      ? opts.queueState
      : await prisma.queueState.findUnique({
          where: { doctor_date: { doctorId: doctor.id, date: appointment.date } },
        });

  const ahead = activeTokens.filter(
    (a) => (a.tokenNumber ?? 0) < tokenNumber && a.id !== appointment.id,
  ).length;

  const delayMins = queueState?.delayMins ?? 0;
  const etaMins = ahead * doctor.avgConsultTimeMins + delayMins;

  return {
    tokenNumber,
    ahead,
    etaMins,
    nowServingToken: queueState?.nowServingToken ?? null,
  };
}

/**
 * Fold an actual consult length into the doctor's rolling average.
 * Behaves as a simple mean until ROLLING_WINDOW samples, then as an EWMA so it
 * keeps tracking recent reality instead of being anchored by ancient data.
 */
export function nextRollingAverage(current: number, sampleCount: number, actualMins: number): number {
  if (sampleCount <= 0) return actualMins;
  if (sampleCount < ROLLING_WINDOW) {
    return (current * sampleCount + actualMins) / (sampleCount + 1);
  }
  return current + (actualMins - current) / ROLLING_WINDOW;
}

/**
 * Record completion of a consult and update the doctor's rolling average.
 * Consult length is measured from startedAt (set when status -> IN_PROGRESS);
 * if the doctor never marked in-progress we have no measurement and the average
 * is left alone.
 */
export async function recordConsultDone(
  appointment: Appointment,
  doctor: Doctor,
  completedAt: Date,
): Promise<{ consultMins: number | null; avgConsultTimeMins: number }> {
  const startedAt = appointment.startedAt;
  if (!startedAt) {
    return { consultMins: null, avgConsultTimeMins: doctor.avgConsultTimeMins };
  }

  const rawMins = (completedAt.getTime() - startedAt.getTime()) / 60_000;
  // Guard against a forgotten "Done" (lunch break, end of day) poisoning the average.
  const consultMins = Math.min(Math.max(Math.round(rawMins), 1), 120);

  const avgConsultTimeMins = nextRollingAverage(
    doctor.avgConsultTimeMins,
    doctor.consultSampleCount,
    consultMins,
  );

  await prisma.$transaction([
    prisma.appointment.update({
      where: { id: appointment.id },
      data: { consultMins },
    }),
    prisma.doctor.update({
      where: { id: doctor.id },
      data: {
        avgConsultTimeMins,
        consultSampleCount: { increment: 1 },
      },
    }),
  ]);

  return { consultMins, avgConsultTimeMins };
}
