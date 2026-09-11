import type { Appointment, AppointmentStatus, Doctor, Patient } from '@prisma/client';
import { prisma } from '../db/prisma';
import { outboundChannelFor } from '../domain/doctors';
import {
  ACTIVE_TOKEN_STATUSES,
  computePosition,
  getActiveTokens,
} from '../domain/tokenQueue';
import { nowServingLabel } from '../i18n/format';
import { t, type TemplateName } from '../i18n/templates';
import { enqueueOutbound, enqueueOutboundBulk, type OutboundJob } from '../queue/queues';
import { logger } from '../utils/logger';
import { formatDateForPatient, formatTimeForPatient, formatWait } from '../utils/time';

/**
 * Outbound notifications that are NOT replies to a patient message: queue
 * position pushes, status changes, delay broadcasts, reminders.
 *
 * Like the conversation engine, this composes text from templates and hands it
 * to the outbound queue. It never calls a provider directly.
 */

type WithPatient = Appointment & { patient: Patient };

function jobFor(doctor: Doctor, patient: Patient, templateName: TemplateName, text: string): OutboundJob {
  const channelAddress = outboundChannelFor(doctor);
  return {
    to: patient.phone,
    text,
    templateName,
    ...(channelAddress ? { channelAddress } : {}),
  };
}

/**
 * Recalculate every active token's position and message whoever actually moved.
 *
 * `lastNotifiedPosition` suppresses no-op pushes: patients only hear from us
 * when their number of people-ahead changed, so a 40-patient queue produces one
 * message per patient per consult, not 40.
 */
export async function broadcastQueuePositions(input: {
  doctorId: string;
  date: Date;
  /** Skip this appointment — it just got its own tailored confirmation. */
  originAppointmentId?: string;
  /** Send even when the position is unchanged (used for delay broadcasts). */
  force?: boolean;
}): Promise<{ notified: number }> {
  const doctor = await prisma.doctor.findUnique({ where: { id: input.doctorId } });
  if (!doctor) return { notified: 0 };

  const [activeTokens, queueState] = await Promise.all([
    getActiveTokens(input.doctorId, input.date),
    prisma.queueState.findUnique({
      where: { doctor_date: { doctorId: input.doctorId, date: input.date } },
    }),
  ]);

  if (!activeTokens.length) return { notified: 0 };

  const patients = await prisma.patient.findMany({
    where: { id: { in: activeTokens.map((a) => a.patientId) } },
  });
  const patientById = new Map(patients.map((p) => [p.id, p]));

  const jobs: OutboundJob[] = [];
  const positionWrites: Array<{ id: string; position: number }> = [];

  for (const appointment of activeTokens) {
    if (appointment.id === input.originAppointmentId) continue;
    // The patient in the room does not need a queue update.
    if (appointment.status === 'IN_PROGRESS') continue;

    const patient = patientById.get(appointment.patientId);
    if (!patient) continue;

    const pos = await computePosition(appointment, doctor, { activeTokens, queueState });

    if (!input.force && appointment.lastNotifiedPosition === pos.ahead) continue;

    const templateName: TemplateName = pos.ahead === 0 ? 'tokenUpNext' : 'tokenPositionUpdate';
    const text =
      pos.ahead === 0
        ? t(patient.language, 'tokenUpNext', { tokenNumber: pos.tokenNumber })
        : t(patient.language, 'tokenPositionUpdate', {
            tokenNumber: pos.tokenNumber,
            nowServing: nowServingLabel(patient.language, pos.nowServingToken),
            ahead: pos.ahead,
            eta: formatWait(pos.etaMins),
          });

    jobs.push(jobFor(doctor, patient, templateName, text));
    positionWrites.push({ id: appointment.id, position: pos.ahead });
  }

  await enqueueOutboundBulk(jobs);

  if (positionWrites.length) {
    await prisma.$transaction(
      positionWrites.map((w) =>
        prisma.appointment.update({
          where: { id: w.id },
          data: { lastNotifiedPosition: w.position },
        }),
      ),
    );
  }

  logger.info(
    { doctorId: input.doctorId, notified: jobs.length },
    'Queue position broadcast complete',
  );
  return { notified: jobs.length };
}

/** Message the patient whose appointment status the doctor just changed. */
export async function notifyStatusChange(
  appointment: WithPatient,
  doctor: Doctor,
  status: AppointmentStatus,
): Promise<void> {
  const patient = appointment.patient;
  const lang = patient.language;

  let templateName: TemplateName | null = null;
  let text: string | null = null;

  switch (status) {
    case 'IN_PROGRESS':
      if (appointment.type === 'TOKEN') {
        templateName = 'tokenYourTurn';
        text = t(lang, 'tokenYourTurn', {
          tokenNumber: appointment.tokenNumber ?? 0,
          doctorName: doctor.name,
        });
      }
      break;
    case 'DONE':
      templateName = 'tokenVisitDone';
      text = t(lang, 'tokenVisitDone', { doctorName: doctor.name });
      break;
    case 'NO_SHOW':
      if (appointment.type === 'TOKEN') {
        templateName = 'tokenNoShow';
        text = t(lang, 'tokenNoShow', { tokenNumber: appointment.tokenNumber ?? 0 });
      }
      break;
    case 'ARRIVED':
      // Nothing to say — the patient is standing in the clinic.
      break;
    default:
      break;
  }

  if (!templateName || !text) return;
  await enqueueOutbound(jobFor(doctor, patient, templateName, text));
}

/** Tell every waiting patient the doctor is running late. */
export async function broadcastDelay(
  doctor: Doctor,
  date: Date,
  delayMins: number,
): Promise<{ notified: number }> {
  const appointments = await prisma.appointment.findMany({
    where: {
      doctorId: doctor.id,
      date,
      status: { in: [...ACTIVE_TOKEN_STATUSES] },
    },
    include: { patient: true },
    orderBy: [{ tokenNumber: 'asc' }, { slotStart: 'asc' }],
  });

  if (!appointments.length) return { notified: 0 };

  const activeTokens = appointments.filter((a) => a.type === 'TOKEN');
  const queueState = await prisma.queueState.findUnique({
    where: { doctor_date: { doctorId: doctor.id, date } },
  });

  const jobs: OutboundJob[] = [];

  for (const appointment of appointments) {
    const lang = appointment.patient.language;

    if (appointment.type === 'TOKEN') {
      const pos = await computePosition(appointment, doctor, { activeTokens, queueState });
      jobs.push(
        jobFor(
          doctor,
          appointment.patient,
          'tokenDelayBroadcast',
          t(lang, 'tokenDelayBroadcast', {
            doctorName: doctor.name,
            delayMins,
            eta: formatWait(pos.etaMins),
          }),
        ),
      );
    } else {
      jobs.push(
        jobFor(
          doctor,
          appointment.patient,
          'slotDelayBroadcast',
          t(lang, 'slotDelayBroadcast', { doctorName: doctor.name, delayMins }),
        ),
      );
    }
  }

  await enqueueOutboundBulk(jobs);
  return { notified: jobs.length };
}

/** Told to patients when the doctor marks a day as leave. */
export async function notifyCancelledByClinic(
  doctor: Doctor,
  appointments: WithPatient[],
): Promise<{ notified: number }> {
  const jobs = appointments.map((appointment) => {
    const lang = appointment.patient.language;
    return appointment.type === 'TOKEN'
      ? jobFor(
          doctor,
          appointment.patient,
          'tokenBookingCancelledByClinic',
          t(lang, 'tokenBookingCancelledByClinic', {
            tokenNumber: appointment.tokenNumber ?? 0,
            date: formatDateForPatient(appointment.date),
          }),
        )
      : jobFor(
          doctor,
          appointment.patient,
          'slotCancelled',
          t(lang, 'slotCancelled', {
            date: formatDateForPatient(appointment.date),
            time: appointment.slotStart
              ? formatTimeForPatient(appointment.slotStart, doctor.timezone)
              : '-',
          }),
        );
  });

  await enqueueOutboundBulk(jobs);
  return { notified: jobs.length };
}
