import { type Response, Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { applyStatusChange, toAppointmentStatus } from '../domain/appointments';
import { buildReport, listPatientsForDoctor, patientHistory } from '../domain/reports';
import { ACTIVE_TOKEN_STATUSES, computePosition } from '../domain/tokenQueue';
import { broadcastDelay } from '../services/notifications';
import { logger } from '../utils/logger';
import {
  clinicToday,
  formatDateForPatient,
  formatDateOnly,
  formatWait,
  parseDateOnly,
} from '../utils/time';
import { t } from '../i18n/templates';
import { enqueueOutbound } from '../queue/queues';
import { requireDoctorAuth, requireFormCsrf } from './middleware/auth';
import {
  type QueueRow,
  bookingsPage,
  patientDetailPage,
  patientsPage,
  reportsPage,
} from './web/doctorViews';
import { delayConfirmPage, queueBody, queuePageV2 } from './web/queueView';
import { errorPage } from './web/views';

/**
 * Doctor console. Mounted under /app so it inherits the urlencoded parser
 * (app.ts scopes it there) and so safeNextPath's /app prefix rule lets the
 * login round-trip work.
 *
 * Routes are cookie-or-key authenticated via requireDoctorAuth, which already
 * accepted both before this console existed.
 */
export const doctorConsoleRouter = Router();

function notFound(res: Response, message: string): void {
  res
    .status(404)
    .type('html')
    .send(errorPage({ title: 'Not found', message, backHref: '/app/queue' }));
}

// ACTIVE_TOKEN_STATUSES is a readonly literal tuple, so .includes() rejects the
// wider AppointmentStatus. A Set<string> widens once here rather than needing a
// cast at each call site.
const ACTIVE = new Set<string>(ACTIVE_TOKEN_STATUSES);

/** Shared by the queue and bookings views: one date's rows plus queue state. */
async function loadDay(doctorId: string, date: Date) {
  const [doctor, appointments, queueState] = await Promise.all([
    prisma.doctor.findUnique({ where: { id: doctorId } }),
    prisma.appointment.findMany({
      where: { doctorId, date },
      include: { patient: { select: { id: true, name: true, phone: true } } },
      orderBy: [{ tokenNumber: 'asc' }, { slotStart: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.queueState.findUnique({ where: { doctor_date: { doctorId, date } } }),
  ]);

  if (!doctor) return null;

  const activeTokens = appointments.filter(
    (a) => a.type === 'TOKEN' && ACTIVE.has(a.status),
  );

  // Precomputed once and handed to every computePosition call, so the map below
  // does no further I/O — same approach as dashboard.ts.
  const rows: QueueRow[] = await Promise.all(
    appointments.map(async (a) => {
      const base: QueueRow = {
        appointmentId: a.id,
        status: a.status,
        type: a.type,
        tokenNumber: a.tokenNumber,
        slotStart: a.slotStart,
        patient: a.patient,
        bookedAt: a.createdAt,
        arrivedAt: a.arrivedAt,
        startedAt: a.startedAt,
        completedAt: a.completedAt,
        consultMins: a.consultMins,
      };

      if (a.type !== 'TOKEN' || !ACTIVE.has(a.status)) return base;

      const position = await computePosition(a, doctor, { activeTokens, queueState });
      return position
        ? { ...base, ahead: position.ahead, etaMins: Math.round(position.etaMins) }
        : base;
    }),
  );

  return {
    doctor,
    rows,
    queue: {
      lastIssuedToken: queueState?.lastIssuedToken ?? 0,
      nowServingToken: queueState?.nowServingToken ?? null,
      delayMins: queueState?.delayMins ?? 0,
      isClosed: queueState?.isClosed ?? false,
      waiting: activeTokens.filter((a) => a.status !== 'IN_PROGRESS').length,
    },
    onLeave: doctor.leaveDates.some((d) => formatDateOnly(d) === formatDateOnly(date)),
  };
}

// ---- queue (today) ----

/**
 * Mean of the waits actually measured today (arrival to being called in).
 * Null rather than 0 when nothing has been measured, so the UI can show a dash
 * instead of implying a real zero-minute wait.
 */
function avgWaitToday(rows: QueueRow[]): number | null {
  const waits = rows
    .filter((r) => r.arrivedAt && r.startedAt)
    .map((r) => (r.startedAt!.getTime() - r.arrivedAt!.getTime()) / 60_000)
    .filter((m) => m >= 0);
  if (waits.length === 0) return null;
  return Math.round(waits.reduce((a, b) => a + b, 0) / waits.length);
}

doctorConsoleRouter.get('/app/queue', requireDoctorAuth, async (req, res) => {
  const doctor = req.doctor!;
  const today = clinicToday(doctor.timezone);
  const day = await loadDay(doctor.id, today);
  if (!day) {
    notFound(res, 'Doctor not found.');
    return;
  }

  const csrfToken = req.csrfToken ?? '';
  const avgWaitMins = avgWaitToday(day.rows);

  // The poll replaces only the live region — hero, action, stats and rows.
  if (req.query['fragment'] !== undefined) {
    res.type('html').send(
      queueBody({
        doctor: day.doctor,
        rows: day.rows,
        queue: day.queue,
        avgWaitMins,
        csrfToken,
      }).__html,
    );
    return;
  }

  res.type('html').send(
    queuePageV2({
      doctor: day.doctor,
      rows: day.rows,
      queue: day.queue,
      avgWaitMins,
      onLeave: day.onLeave,
      csrfToken,
      ...(typeof req.query['flash'] === 'string' ? { flash: req.query['flash'] } : {}),
    }),
  );
});

/**
 * Re-send the "it's your turn" message to whoever is already in progress —
 * for when a patient was called but did not hear it. Sends the same template
 * the state machine uses rather than inventing a second wording.
 */
doctorConsoleRouter.post(
  '/app/queue/:appointmentId/recall',
  requireDoctorAuth,
  requireFormCsrf,
  async (req, res) => {
    const doctor = req.doctor!;
    const appointment = await prisma.appointment.findUnique({
      where: { id: req.params['appointmentId'] ?? '' },
      include: { patient: true },
    });

    if (!appointment || appointment.doctorId !== doctor.id) {
      notFound(res, 'Appointment not found.');
      return;
    }

    await enqueueOutbound({
      to: appointment.patient.phone,
      text: t(appointment.patient.language, 'tokenYourTurn', {
        tokenNumber: appointment.tokenNumber ?? 0,
        doctorName: doctor.name,
      }),
      templateName: 'tokenYourTurn',
      ...(doctor.whatsappPhoneNumberId
        ? { channelAddress: doctor.whatsappPhoneNumberId }
        : {}),
    });

    res.redirect(302, `/app/queue?flash=${encodeURIComponent('Called again')}`);
  },
);

// ---- queue actions ----

doctorConsoleRouter.post(
  '/app/queue/:appointmentId/status',
  requireDoctorAuth,
  requireFormCsrf,
  async (req, res) => {
    const doctor = req.doctor!;
    const raw = (req.body as { status?: unknown })?.status;
    const status = typeof raw === 'string' ? toAppointmentStatus(raw) : null;

    if (!status) {
      notFound(res, 'Unknown status change.');
      return;
    }

    const appointment = await prisma.appointment.findUnique({
      where: { id: req.params['appointmentId'] ?? '' },
    });
    if (!appointment || appointment.doctorId !== doctor.id) {
      notFound(res, 'Appointment not found.');
      return;
    }

    await applyStatusChange(appointment, doctor, status);
    res.redirect(302, '/app/queue');
  },
);

const delayBody = z.object({ delayMins: z.coerce.number().int().min(1).max(480) });

/**
 * Step one of announcing a delay: show the exact WhatsApp text and the real
 * recipient count before anything leaves the building. Broadcasts are the one
 * action here that cannot be taken back.
 */
doctorConsoleRouter.post(
  '/app/queue/delay/confirm',
  requireDoctorAuth,
  requireFormCsrf,
  async (req, res) => {
    const doctor = req.doctor!;
    const parsed = delayBody.safeParse(req.body);
    if (!parsed.success) {
      res.redirect(302, '/app/queue?flash=Enter+between+1+and+480+minutes');
      return;
    }

    const date = clinicToday(doctor.timezone);
    const recipients = await prisma.appointment.count({
      where: { doctorId: doctor.id, date, status: { in: [...ACTIVE_TOKEN_STATUSES] } },
    });

    // Rendered with the doctor's own language so the preview matches what a
    // patient on that language actually receives; per-patient language still
    // applies at send time.
    const messagePreview = t(doctor.defaultLanguage, 'tokenDelayBroadcast', {
      doctorName: doctor.name,
      delayMins: parsed.data.delayMins,
      eta: formatWait(parsed.data.delayMins),
    });

    res.type('html').send(
      delayConfirmPage({
        doctor,
        delayMins: parsed.data.delayMins,
        recipients,
        messagePreview,
        csrfToken: req.csrfToken ?? '',
      }),
    );
  },
);

doctorConsoleRouter.post(
  '/app/queue/delay',
  requireDoctorAuth,
  requireFormCsrf,
  async (req, res) => {
    const doctor = req.doctor!;
    const parsed = delayBody.safeParse(req.body);
    if (!parsed.success) {
      res.redirect(302, '/app/queue?flash=Delay+must+be+between+1+and+480+minutes');
      return;
    }

    const date = clinicToday(doctor.timezone);
    await prisma.queueState.upsert({
      where: { doctor_date: { doctorId: doctor.id, date } },
      create: { doctorId: doctor.id, date, delayMins: parsed.data.delayMins },
      update: { delayMins: parsed.data.delayMins },
    });

    const result = await broadcastDelay(doctor, date, parsed.data.delayMins).catch((err) => {
      logger.error({ err }, 'Delay broadcast failed');
      return { notified: 0 };
    });

    res.redirect(
      302,
      `/app/queue?flash=${encodeURIComponent(`Delay announced to ${result.notified} patient(s)`)}`,
    );
  },
);

// ---- bookings (any date) ----

doctorConsoleRouter.get('/app/bookings', requireDoctorAuth, async (req, res) => {
  const doctor = req.doctor!;
  const today = clinicToday(doctor.timezone);

  const requested = typeof req.query['date'] === 'string' ? parseDateOnly(req.query['date']) : null;
  const date = requested ?? today;

  const day = await loadDay(doctor.id, date);
  if (!day) {
    notFound(res, 'Doctor not found.');
    return;
  }

  const shift = (n: number) => {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + n);
    return formatDateOnly(d);
  };

  res.type('html').send(
    bookingsPage({
      doctor: day.doctor,
      rows: day.rows,
      queue: day.queue,
      date: formatDateOnly(date),
      prevDate: shift(-1),
      nextDate: shift(1),
      isToday: formatDateOnly(date) === formatDateOnly(today),
      isPast: date.getTime() < today.getTime(),
      dateLabel: formatDateForPatient(date),
      csrfToken: req.csrfToken ?? '',
    }),
  );
});

// ---- patients ----

doctorConsoleRouter.get('/app/patients', requireDoctorAuth, async (req, res) => {
  const doctor = req.doctor!;
  const patients = await listPatientsForDoctor(doctor.id);
  res.type('html').send(patientsPage({ doctor, patients, csrfToken: req.csrfToken ?? '' }));
});

doctorConsoleRouter.get('/app/patients/:id', requireDoctorAuth, async (req, res) => {
  const doctor = req.doctor!;
  const { patient, appointments } = await patientHistory(doctor.id, req.params['id'] ?? '');

  // Scoped by construction: patientHistory filters on doctorId, so a patient who
  // has never booked with this doctor comes back with an empty list.
  if (!patient || appointments.length === 0) {
    notFound(res, 'No patient of yours with that id.');
    return;
  }

  res
    .type('html')
    .send(patientDetailPage({ doctor, patient, appointments, csrfToken: req.csrfToken ?? '' }));
});

// ---- reports ----

doctorConsoleRouter.get('/app/reports', requireDoctorAuth, async (req, res) => {
  const doctor = req.doctor!;
  const requested = Number.parseInt(String(req.query['days'] ?? ''), 10);
  const days = [7, 30, 90].includes(requested) ? requested : 30;

  const report = await buildReport(doctor, days);
  res.type('html').send(reportsPage({ doctor, report, days, csrfToken: req.csrfToken ?? '' }));
});
