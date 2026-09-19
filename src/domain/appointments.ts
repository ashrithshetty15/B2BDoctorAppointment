import type { Appointment, AppointmentStatus, Doctor } from '@prisma/client';
import { prisma } from '../db/prisma';
import { InvalidTransitionError, canTransition } from './queueLifecycle';
import { markVisited } from './patients';
import { recordConsultDone } from './tokenQueue';

/**
 * Appointment lifecycle transitions shared by the WhatsApp flows and the
 * dashboard API. Keeping them here means "Done" always updates the rolling
 * average and the now-serving pointer, whichever caller triggered it.
 */

export type DashboardStatus = 'arrived' | 'in-progress' | 'done' | 'no-show';

const STATUS_MAP: Record<DashboardStatus, AppointmentStatus> = {
  arrived: 'ARRIVED',
  'in-progress': 'IN_PROGRESS',
  done: 'DONE',
  'no-show': 'NO_SHOW',
};

export function toAppointmentStatus(input: string): AppointmentStatus | null {
  return STATUS_MAP[input as DashboardStatus] ?? null;
}

export async function cancelAppointment(
  appointmentId: string,
  at: Date = new Date(),
): Promise<Appointment> {
  return prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: 'CANCELLED', cancelledAt: at },
  });
}

export interface StatusChangeResult {
  appointment: Appointment;
  /** Set when the transition updated the doctor's rolling average. */
  avgConsultTimeMins?: number;
  consultMins?: number | null;
}

/**
 * Apply a dashboard status transition and keep derived state consistent:
 * - IN_PROGRESS sets startedAt and points QueueState.nowServingToken here
 * - DONE stamps completedAt, folds the consult length into the rolling average,
 *   and updates the patient's last_visit
 * - NO_SHOW clears the now-serving pointer if it was this token
 */
export async function applyStatusChange(
  appointment: Appointment,
  doctor: Doctor,
  status: AppointmentStatus,
  at: Date = new Date(),
): Promise<StatusChangeResult> {
  // Rejected here rather than in each console, because three of them plus the
  // JSON API can all reach this. Previously any status could follow any other,
  // so an appointment could reach IN_PROGRESS without an arrivedAt — which is
  // what made the average wait meaningless.
  if (appointment.status !== status && !canTransition(appointment.status, status)) {
    throw new InvalidTransitionError(appointment.status, status);
  }

  const data: Parameters<typeof prisma.appointment.update>[0]['data'] = { status };

  switch (status) {
    case 'ARRIVED':
      data.arrivedAt = at;
      break;
    case 'IN_PROGRESS':
      data.startedAt = at;
      break;
    case 'DONE':
      data.completedAt = at;
      break;
    default:
      break;
  }

  const updated = await prisma.appointment.update({ where: { id: appointment.id }, data });

  let avgConsultTimeMins: number | undefined;
  let consultMins: number | null | undefined;

  if (appointment.type === 'TOKEN' && appointment.tokenNumber !== null) {
    if (status === 'IN_PROGRESS') {
      await prisma.queueState.upsert({
        where: { doctor_date: { doctorId: doctor.id, date: appointment.date } },
        create: {
          doctorId: doctor.id,
          date: appointment.date,
          nowServingToken: appointment.tokenNumber,
        },
        update: { nowServingToken: appointment.tokenNumber },
      });
    }

    if (status === 'DONE' || status === 'NO_SHOW') {
      // Clear the pointer only if it still refers to this token.
      await prisma.queueState.updateMany({
        where: {
          doctorId: doctor.id,
          date: appointment.date,
          nowServingToken: appointment.tokenNumber,
        },
        data: { nowServingToken: status === 'DONE' ? appointment.tokenNumber : null },
      });
    }
  }

  if (status === 'DONE') {
    const result = await recordConsultDone({ ...appointment, startedAt: appointment.startedAt }, doctor, at);
    avgConsultTimeMins = result.avgConsultTimeMins;
    consultMins = result.consultMins;
    await markVisited(appointment.patientId, at);
  }

  return {
    appointment: updated,
    ...(avgConsultTimeMins !== undefined ? { avgConsultTimeMins } : {}),
    ...(consultMins !== undefined ? { consultMins } : {}),
  };
}
