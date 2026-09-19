import type { AppointmentStatus } from '@prisma/client';

/**
 * The appointment lifecycle, as one explicit machine.
 *
 *   BOOKED ──► ARRIVED ──► IN_PROGRESS ──► DONE
 *      │           │
 *      └───────────┴──► NO_SHOW ──► ARRIVED   (they turned up late)
 *      └───────────┴──► CANCELLED
 *
 * Written down because it was previously implied by whichever buttons a view
 * happened to render: applyStatusChange accepted any status from any status, so
 * a DONE appointment could be sent back to BOOKED and a patient could reach
 * IN_PROGRESS with no arrivedAt, which is what made the average wait unusable.
 *
 * IN_PROGRESS is the stored name for what the desk calls "in the room". Kept as
 * it is rather than renamed: the value is written by the bot, the dashboard and
 * three consoles, and a rename would be a data migration for a vocabulary
 * change.
 *
 * NO_SHOW back to ARRIVED is deliberate. A patient marked missed who then walks
 * in is ordinary, and without it the desk has to cancel and rebook them.
 */
const TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  BOOKED: ['ARRIVED', 'NO_SHOW', 'CANCELLED'],
  ARRIVED: ['IN_PROGRESS', 'NO_SHOW', 'CANCELLED'],
  IN_PROGRESS: ['DONE'],
  DONE: [],
  NO_SHOW: ['ARRIVED'],
  CANCELLED: [],
};

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: AppointmentStatus): readonly AppointmentStatus[] {
  return TRANSITIONS[from];
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: AppointmentStatus,
    readonly to: AppointmentStatus,
  ) {
    super(`Cannot move an appointment from ${from} to ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

/**
 * The single action a card offers for its current state.
 *
 * One per state, so a row never presents two equally-weighted choices and the
 * desk can work down the list without reading each card. Everything else valid
 * goes in the overflow.
 */
export type QueueAction = 'ARRIVED' | 'IN_PROGRESS' | 'DONE';

export function primaryAction(status: AppointmentStatus): QueueAction | null {
  switch (status) {
    case 'BOOKED':
      return 'ARRIVED';
    case 'ARRIVED':
      return 'IN_PROGRESS';
    case 'IN_PROGRESS':
      return 'DONE';
    default:
      // Finished or abandoned: nothing to do from the queue.
      return null;
  }
}

/** Valid moves that are not the primary one — the overflow menu's contents. */
export function secondaryActions(status: AppointmentStatus): AppointmentStatus[] {
  const primary = primaryAction(status);
  return TRANSITIONS[status].filter((s) => s !== primary);
}

/**
 * Which section of the queue a row belongs in.
 *
 * Derived from status alone so the list and its counters cannot disagree —
 * they previously did, because the list came from every appointment that day
 * while the counters came from a separate token-only query.
 */
export type QueueSection = 'IN_ROOM' | 'WAITING' | 'EXPECTED' | 'CLOSED';

export function sectionFor(status: AppointmentStatus): QueueSection {
  switch (status) {
    case 'IN_PROGRESS':
      return 'IN_ROOM';
    case 'ARRIVED':
      return 'WAITING';
    case 'BOOKED':
      return 'EXPECTED';
    default:
      return 'CLOSED';
  }
}

/**
 * How long someone has been waiting, in minutes — or null if they have not
 * arrived yet.
 *
 * Null is the point. Waiting used to be measured from the booking, so a patient
 * who booked at 07:13 for a 10:00 appointment was shown as having waited nearly
 * three hours while sitting at home.
 */
export function waitedMins(
  row: { arrivedAt: Date | null; startedAt: Date | null },
  now: Date,
): number | null {
  if (!row.arrivedAt) return null;
  const until = row.startedAt ?? now;
  return Math.max(0, Math.round((until.getTime() - row.arrivedAt.getTime()) / 60_000));
}

/**
 * Severity of a wait, for the colour of the badge.
 *
 * Never the only signal — the view pairs each with its own words, so the
 * distinction survives a monochrome screen and colour-blind eyes.
 */
export type WaitLevel = 'calm' | 'warn' | 'urgent';

export function waitLevel(mins: number | null): WaitLevel {
  if (mins === null || mins < 15) return 'calm';
  return mins <= 30 ? 'warn' : 'urgent';
}
