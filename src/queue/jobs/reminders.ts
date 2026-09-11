import type { Job } from 'bullmq';
import { prisma } from '../../db/prisma';
import { outboundChannelFor } from '../../domain/doctors';
import { dayBeforeReminderAt, hourBeforeReminderAt } from '../../domain/slots';
import { t } from '../../i18n/templates';
import { logger } from '../../utils/logger';
import { formatDateForPatient, formatTimeForPatient } from '../../utils/time';
import { enqueueOutbound, scheduleReminder, type ReminderJob, type ReminderKind } from '../queues';

/**
 * SLOT-mode reminders: the evening before (6 PM) and one hour ahead.
 *
 * Two mechanisms on purpose:
 *  - exact delayed jobs, scheduled when an appointment is booked
 *  - a 10-minute sweep over the Appointment table, which catches anything the
 *    delayed jobs missed (worker down, Redis flushed, appointment moved)
 * The `*ReminderSentAt` columns make both paths idempotent.
 */

export async function processReminder(job: Job<ReminderJob>): Promise<void> {
  if (job.data.kind === 'SWEEP') {
    const sent = await sweepDueReminders();
    logger.info({ sent }, 'Reminder sweep complete');
    return;
  }

  await sendReminder(job.data.appointmentId, job.data.kind);
}

/** Schedule both reminders for a freshly booked slot appointment. */
export async function scheduleRemindersFor(appointmentId: string): Promise<void> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { doctor: true },
  });
  if (!appointment || appointment.type !== 'SLOT' || !appointment.slotStart) return;

  const dayBefore = dayBeforeReminderAt(appointment.date, appointment.doctor.timezone);
  if (dayBefore) {
    await scheduleReminder({ kind: 'DAY_BEFORE', appointmentId }, dayBefore);
  }
  await scheduleReminder(
    { kind: 'HOUR_BEFORE', appointmentId },
    hourBeforeReminderAt(appointment.slotStart),
  );
}

async function sendReminder(appointmentId: string, kind: ReminderKind): Promise<boolean> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { doctor: true, patient: true },
  });

  if (!appointment || appointment.status !== 'BOOKED' || !appointment.slotStart) return false;

  const alreadySent =
    kind === 'DAY_BEFORE'
      ? appointment.dayBeforeReminderSentAt !== null
      : appointment.hourBeforeReminderSentAt !== null;
  if (alreadySent) return false;

  const { doctor, patient } = appointment;
  const lang = patient.language;
  const time = formatTimeForPatient(appointment.slotStart, doctor.timezone);
  const channelAddress = outboundChannelFor(doctor);

  const text =
    kind === 'DAY_BEFORE'
      ? t(lang, 'slotReminderDayBefore', {
          doctorName: doctor.name,
          clinicName: doctor.clinicName,
          date: formatDateForPatient(appointment.date),
          time,
        })
      : t(lang, 'slotReminderHourBefore', { doctorName: doctor.name, time });

  await enqueueOutbound({
    to: patient.phone,
    text,
    templateName: kind === 'DAY_BEFORE' ? 'slotReminderDayBefore' : 'slotReminderHourBefore',
    ...(channelAddress ? { channelAddress } : {}),
  });

  await prisma.appointment.update({
    where: { id: appointment.id },
    data:
      kind === 'DAY_BEFORE'
        ? { dayBeforeReminderSentAt: new Date() }
        : { hourBeforeReminderSentAt: new Date() },
  });

  return true;
}

/** Find reminders that are due now and send whatever has not gone out. */
async function sweepDueReminders(): Promise<number> {
  const now = new Date();
  const inOneHour = new Date(now.getTime() + 60 * 60_000);

  // 1-hour-before: slot starts within the next hour.
  const hourCandidates = await prisma.appointment.findMany({
    where: {
      type: 'SLOT',
      status: 'BOOKED',
      hourBeforeReminderSentAt: null,
      slotStart: { gt: now, lte: inOneHour },
    },
    select: { id: true },
    take: 500,
  });

  // Day-before: any booked future slot whose 6 PM reminder time has passed.
  const dayCandidates = await prisma.appointment.findMany({
    where: {
      type: 'SLOT',
      status: 'BOOKED',
      dayBeforeReminderSentAt: null,
      slotStart: { gt: now },
    },
    include: { doctor: { select: { timezone: true } } },
    take: 500,
  });

  let sent = 0;

  for (const row of hourCandidates) {
    if (await sendReminder(row.id, 'HOUR_BEFORE')) sent += 1;
  }

  for (const row of dayCandidates) {
    const dueAt = dayBeforeReminderAt(row.date, row.doctor.timezone);
    if (dueAt && dueAt <= now) {
      if (await sendReminder(row.id, 'DAY_BEFORE')) sent += 1;
    }
  }

  return sent;
}
