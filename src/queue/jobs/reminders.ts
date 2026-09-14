import type { Job } from 'bullmq';
import { env } from '../../config/env';
import { prisma } from '../../db/prisma';
import { getMessagingAdapter } from '../../messaging';
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

  sent += await sweepDueFollowUps();
  return sent;
}

/**
 * Send follow-up reminders that have come due.
 *
 * Rides the existing 10-minute sweep rather than scheduling delayed jobs: a
 * follow-up is weeks out, and a delayed job that far ahead is exactly the thing
 * a Redis flush loses. The followUpSentAt column makes it idempotent.
 *
 * A follow-up is always outside WhatsApp's 24-hour free-form window, so it can
 * only go as an approved template. With none configured this does nothing at all
 * — deliberately. The alternative is attempting a send that Meta rejects with an
 * error our adapter cannot distinguish from a transient failure, which would
 * retry five times, drop it, and mark nothing: the clinic would believe patients
 * had been reminded when none had.
 */
async function sweepDueFollowUps(): Promise<number> {
  const templateName = env.WHATSAPP_FOLLOWUP_TEMPLATE;
  if (!templateName) return 0;

  const adapter = getMessagingAdapter();
  if (!adapter.sendTemplate) return 0;

  const today = new Date();
  const due = await prisma.appointment.findMany({
    where: { followUpOn: { lte: today }, followUpSentAt: null },
    include: { patient: true, doctor: true },
    take: 200,
  });

  let sent = 0;
  for (const appointment of due) {
    try {
      const channel = outboundChannelFor(appointment.doctor);
      await adapter.sendTemplate({
        to: appointment.patient.phone,
        templateName,
        // The patient's own language, not the clinic's default. The template
        // must be approved in this language or Meta refuses it.
        languageCode: appointment.patient.language === 'KN' ? 'kn' : 'en_US',
        params: [appointment.patient.name ?? '', appointment.doctor.name],
        ...(channel ? { channelAddress: channel } : {}),
      });
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { followUpSentAt: new Date() },
      });
      sent += 1;
    } catch (err) {
      // Left unstamped so the next sweep retries, and so the console keeps
      // showing it as pending rather than claiming the patient was told.
      logger.warn({ err, appointmentId: appointment.id }, 'Follow-up send failed');
    }
  }

  return sent;
}
