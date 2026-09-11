import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { applyStatusChange, cancelAppointment, toAppointmentStatus } from '../domain/appointments';
import { getAvailableSlots } from '../domain/slots';
import { ACTIVE_TOKEN_STATUSES, computePosition, getOrCreateQueueState } from '../domain/tokenQueue';
import { enqueueTokenQueueRecalc, cancelReminders } from '../queue/queues';
import {
  broadcastDelay,
  notifyCancelledByClinic,
  notifyStatusChange,
} from '../services/notifications';
import { clinicToday, formatDateOnly, parseDateOnly } from '../utils/time';
import { requireDoctorApiKey } from './middleware/auth';

/**
 * Dashboard API (requirement 6). Auth is one API key per doctor — see
 * middleware/auth.ts. Every route is scoped to the key's own doctor.
 */
export const dashboardRouter = Router();

// ---------------------------------------------------------------------------
// GET /doctor/:id/today — today's queue (TOKEN) or schedule (SLOT)
// ---------------------------------------------------------------------------
dashboardRouter.get('/doctor/:id/today', requireDoctorApiKey, async (req, res) => {
  const doctor = req.doctor!;
  const dateParam = typeof req.query['date'] === 'string' ? req.query['date'] : null;
  const date = dateParam ? parseDateOnly(dateParam) : clinicToday(doctor.timezone);

  if (!date) {
    res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    return;
  }

  const [appointments, queueState] = await Promise.all([
    prisma.appointment.findMany({
      where: { doctorId: doctor.id, date },
      include: { patient: { select: { id: true, name: true, phone: true, lastVisitAt: true } } },
      orderBy: [{ tokenNumber: 'asc' }, { slotStart: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.queueState.findUnique({ where: { doctor_date: { doctorId: doctor.id, date } } }),
  ]);

  const activeTokens = appointments.filter(
    (a) => a.type === 'TOKEN' && ACTIVE_TOKEN_STATUSES.includes(a.status as 'BOOKED'),
  );

  const rows = await Promise.all(
    appointments.map(async (a) => {
      const position =
        a.type === 'TOKEN' && ACTIVE_TOKEN_STATUSES.includes(a.status as 'BOOKED')
          ? await computePosition(a, doctor, { activeTokens, queueState })
          : null;

      return {
        appointmentId: a.id,
        type: a.type,
        status: a.status,
        tokenNumber: a.tokenNumber,
        slotStart: a.slotStart,
        slotEnd: a.slotEnd,
        patient: a.patient,
        arrivedAt: a.arrivedAt,
        startedAt: a.startedAt,
        completedAt: a.completedAt,
        consultMins: a.consultMins,
        ...(position
          ? { ahead: position.ahead, etaMins: Math.round(position.etaMins) }
          : {}),
      };
    }),
  );

  const availableSlots =
    doctor.bookingMode === 'TOKEN'
      ? undefined
      : (await getAvailableSlots(doctor, date)).map((s) => ({ start: s.start, end: s.end }));

  res.json({
    doctor: {
      id: doctor.id,
      name: doctor.name,
      clinicName: doctor.clinicName,
      bookingMode: doctor.bookingMode,
      dailyTokenCap: doctor.dailyTokenCap,
      avgConsultTimeMins: Number(doctor.avgConsultTimeMins.toFixed(1)),
      timezone: doctor.timezone,
    },
    date: formatDateOnly(date),
    onLeave: doctor.leaveDates.some((d) => formatDateOnly(d) === formatDateOnly(date)),
    queue: {
      lastIssuedToken: queueState?.lastIssuedToken ?? 0,
      nowServingToken: queueState?.nowServingToken ?? null,
      delayMins: queueState?.delayMins ?? 0,
      isClosed: queueState?.isClosed ?? false,
      waiting: activeTokens.filter((a) => a.status !== 'IN_PROGRESS').length,
    },
    ...(availableSlots ? { availableSlots } : {}),
    appointments: rows,
  });
});

// ---------------------------------------------------------------------------
// POST /appointment/:id/status — arrived | in-progress | done | no-show
// ---------------------------------------------------------------------------
const statusBody = z.object({
  status: z.enum(['arrived', 'in-progress', 'done', 'no-show']),
});

dashboardRouter.post('/appointment/:id/status', requireDoctorApiKey, async (req, res) => {
  const doctor = req.doctor!;
  const parsed = statusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'status must be one of: arrived, in-progress, done, no-show',
    });
    return;
  }

  const appointmentId = req.params['id'] ?? '';
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { patient: true },
  });

  if (!appointment || appointment.doctorId !== doctor.id) {
    res.status(404).json({ error: 'Appointment not found' });
    return;
  }

  const status = toAppointmentStatus(parsed.data.status);
  if (!status) {
    res.status(400).json({ error: 'Unsupported status' });
    return;
  }

  const result = await applyStatusChange(appointment, doctor, status);

  // Patient-facing side effects go through the queues, so the dashboard call
  // returns as soon as the DB is consistent.
  await notifyStatusChange({ ...result.appointment, patient: appointment.patient }, doctor, status);

  if (appointment.type === 'TOKEN') {
    await enqueueTokenQueueRecalc({
      doctorId: doctor.id,
      date: appointment.date,
      trigger: 'STATUS_CHANGED',
      originAppointmentId: appointment.id,
    });
  }

  res.json({
    appointmentId: result.appointment.id,
    status: result.appointment.status,
    ...(result.consultMins !== undefined ? { consultMins: result.consultMins } : {}),
    ...(result.avgConsultTimeMins !== undefined
      ? { avgConsultTimeMins: Number(result.avgConsultTimeMins.toFixed(1)) }
      : {}),
  });
});

// ---------------------------------------------------------------------------
// POST /doctor/:id/delay-broadcast — tell today's waiting patients
// ---------------------------------------------------------------------------
const delayBody = z.object({
  delayMins: z.coerce.number().int().min(1).max(480),
  date: z.string().optional(),
});

dashboardRouter.post('/doctor/:id/delay-broadcast', requireDoctorApiKey, async (req, res) => {
  const doctor = req.doctor!;
  const parsed = delayBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'delayMins must be an integer between 1 and 480' });
    return;
  }

  const date = parsed.data.date
    ? parseDateOnly(parsed.data.date)
    : clinicToday(doctor.timezone);
  if (!date) {
    res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    return;
  }

  // Recorded on the queue so every later ETA includes it.
  await getOrCreateQueueState(doctor.id, date);
  await prisma.queueState.update({
    where: { doctor_date: { doctorId: doctor.id, date } },
    data: { delayMins: parsed.data.delayMins },
  });

  const { notified } = await broadcastDelay(doctor, date, parsed.data.delayMins);

  res.json({ date: formatDateOnly(date), delayMins: parsed.data.delayMins, notified });
});

// ---------------------------------------------------------------------------
// POST /doctor/:id/leave — mark a date unavailable
// ---------------------------------------------------------------------------
const leaveBody = z.object({
  date: z.string(),
  /** Cancel and notify anyone already booked that day. Default true. */
  cancelExisting: z.boolean().optional(),
});

dashboardRouter.post('/doctor/:id/leave', requireDoctorApiKey, async (req, res) => {
  const doctor = req.doctor!;
  const parsed = leaveBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'date (YYYY-MM-DD) is required' });
    return;
  }

  const date = parseDateOnly(parsed.data.date);
  if (!date) {
    res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    return;
  }

  const alreadyOnLeave = doctor.leaveDates.some(
    (d) => formatDateOnly(d) === formatDateOnly(date),
  );

  if (!alreadyOnLeave) {
    await prisma.doctor.update({
      where: { id: doctor.id },
      data: { leaveDates: { push: date } },
    });
  }

  // Stop new tokens being issued for that date.
  await getOrCreateQueueState(doctor.id, date);
  await prisma.queueState.update({
    where: { doctor_date: { doctorId: doctor.id, date } },
    data: { isClosed: true },
  });

  let cancelled = 0;
  let notified = 0;

  if (parsed.data.cancelExisting !== false) {
    const affected = await prisma.appointment.findMany({
      where: {
        doctorId: doctor.id,
        date,
        status: { in: [...ACTIVE_TOKEN_STATUSES] },
      },
      include: { patient: true },
    });

    for (const appointment of affected) {
      await cancelAppointment(appointment.id);
      await cancelReminders(appointment.id);
      cancelled += 1;
    }

    ({ notified } = await notifyCancelledByClinic(doctor, affected));
  }

  res.json({ date: formatDateOnly(date), onLeave: true, cancelled, notified });
});
