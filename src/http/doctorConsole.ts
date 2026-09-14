import { type Response, Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { applyStatusChange, toAppointmentStatus } from '../domain/appointments';
import { buildReport, listPatientsForDoctor, patientHistory } from '../domain/reports';
import { addDocument, deleteDocument, getDocumentForDoctor } from '../domain/documents';
import { storage } from '../domain/storage';
import { findOrCreatePatient, isPlausibleName, setPatientName } from '../domain/patients';
import { bookSlot, getDaySchedule } from '../domain/slots';
import { ACTIVE_TOKEN_STATUSES, computePosition, isOnLeave, issueToken } from '../domain/tokenQueue';
import { broadcastDelay } from '../services/notifications';
import { logger } from '../utils/logger';
import {
  clinicToday,
  formatDateForPatient,
  formatDateOnly,
  formatTimeForPatient,
  formatWait,
  parseDateOnly,
} from '../utils/time';
import { c } from '../i18n/console';
import { nowServingLabel } from '../i18n/format';
import { t } from '../i18n/templates';
import { enqueueOutbound } from '../queue/queues';
import { requireDoctorAuth, requireFormCsrf } from './middleware/auth';
import { safeNextPath } from './web/negotiate';
import {
  type QueueRow,
  bookingsPage,
  patientDetailPage,
  patientsPage,
  reportsPage,
} from './web/doctorViews';
import { calendarPage, slotBookPage } from './web/calendarView';
import { delayConfirmPage, queueBody, queuePageV2, walkInPage } from './web/queueView';
import { settingsPage } from './web/settingsView';
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
        notes: a.notes,
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
 * Waiting patients right now — the badge on the Queue tab. Every doctor page
 * shows it, so the nav stays informative wherever the doctor happens to be.
 * IN_PROGRESS is excluded: that patient is with the doctor, not waiting.
 */
async function waitingCount(doctorId: string, timezone: string): Promise<number> {
  return prisma.appointment.count({
    where: {
      doctorId,
      date: clinicToday(timezone),
      type: 'TOKEN',
      status: { in: ['BOOKED', 'ARRIVED'] },
    },
  });
}

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

/**
 * Edit a remark after booking. The desk captures context at the counter, but
 * the useful note often arrives during the visit — a remark that could only be
 * written at booking time would mostly go unwritten.
 */
const noteBody = z.object({ notes: z.string().trim().max(500) });

doctorConsoleRouter.post(
  '/app/appointment/:appointmentId/note',
  requireDoctorAuth,
  requireFormCsrf,
  async (req, res) => {
    const doctor = req.doctor!;
    const s = c(doctor.defaultLanguage);
    const parsed = noteBody.safeParse(req.body ?? {});

    const appointment = await prisma.appointment.findUnique({
      where: { id: req.params['appointmentId'] ?? '' },
      select: { id: true, doctorId: true },
    });
    if (!appointment || appointment.doctorId !== doctor.id) {
      notFound(res, 'Appointment not found.');
      return;
    }

    await prisma.appointment.update({
      where: { id: appointment.id },
      // Empty clears the remark rather than storing a blank string.
      data: { notes: parsed.success && parsed.data.notes ? parsed.data.notes : null },
    });

    const back = typeof req.body?.back === 'string' ? safeNextPath(req.body.back) : null;
    res.redirect(302, `${back ?? '/app/queue'}?flash=${encodeURIComponent(s.noteSaved)}`);
  },
);

// ---- calendar (SLOT / HYBRID) ----

function shiftDate(date: Date, days: number): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDateOnly(d);
}

doctorConsoleRouter.get('/app/calendar', requireDoctorAuth, async (req, res) => {
  const doctor = req.doctor!;
  const today = clinicToday(doctor.timezone);
  const requested =
    typeof req.query['date'] === 'string' ? parseDateOnly(req.query['date']) : null;
  const date = requested ?? today;

  const [slots, queueCount] = await Promise.all([
    getDaySchedule(doctor, date),
    waitingCount(doctor.id, doctor.timezone),
  ]);

  res.type('html').send(
    calendarPage({
      doctor,
      slots,
      date: formatDateOnly(date),
      prevDate: shiftDate(date, -1),
      nextDate: shiftDate(date, 1),
      dateLabel: formatDateForPatient(date),
      isToday: formatDateOnly(date) === formatDateOnly(today),
      onLeave: isOnLeave(doctor, date),
      queueCount,
      csrfToken: req.csrfToken ?? '',
      ...(typeof req.query['flash'] === 'string' ? { flash: req.query['flash'] } : {}),
    }),
  );
});

doctorConsoleRouter.get('/app/calendar/book', requireDoctorAuth, async (req, res) => {
  const doctor = req.doctor!;
  const date = typeof req.query['date'] === 'string' ? parseDateOnly(req.query['date']) : null;
  const slotIso = typeof req.query['slot'] === 'string' ? req.query['slot'] : '';
  const slotStart = new Date(slotIso);

  if (!date || Number.isNaN(slotStart.getTime())) {
    notFound(res, 'That appointment time could not be found.');
    return;
  }

  res.type('html').send(
    slotBookPage({
      doctor,
      date: formatDateOnly(date),
      slotIso,
      slotLabel: formatTimeForPatient(slotStart, doctor.timezone),
      dateLabel: formatDateForPatient(date),
      queueCount: await waitingCount(doctor.id, doctor.timezone),
      csrfToken: req.csrfToken ?? '',
    }),
  );
});

const slotBookBody = z.object({
  date: z.string(),
  slot: z.string(),
  name: z.string().trim().min(1),
  phone: z.string().trim().min(1),
  language: z.enum(['EN', 'KN']).optional(),
  notes: z.string().trim().max(500).optional(),
});

doctorConsoleRouter.post(
  '/app/calendar/book',
  requireDoctorAuth,
  requireFormCsrf,
  async (req, res) => {
    const doctor = req.doctor!;
    const s = c(doctor.defaultLanguage);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsed = slotBookBody.safeParse(body);

    const rawDate = typeof body['date'] === 'string' ? body['date'] : '';
    const rawSlot = typeof body['slot'] === 'string' ? body['slot'] : '';
    const date = parseDateOnly(rawDate);
    const slotStart = new Date(rawSlot);

    if (!date || Number.isNaN(slotStart.getTime())) {
      notFound(res, 'That appointment time could not be found.');
      return;
    }

    const values = {
      name: typeof body['name'] === 'string' ? body['name'] : '',
      phone: typeof body['phone'] === 'string' ? body['phone'] : '',
      language: typeof body['language'] === 'string' ? body['language'] : undefined,
      notes: typeof body['notes'] === 'string' ? body['notes'] : '',
    };

    const reject = async (error: string) =>
      res.type('html').send(
        slotBookPage({
          doctor,
          date: rawDate,
          slotIso: rawSlot,
          slotLabel: formatTimeForPatient(slotStart, doctor.timezone),
          dateLabel: formatDateForPatient(date),
          queueCount: await waitingCount(doctor.id, doctor.timezone),
          csrfToken: req.csrfToken ?? '',
          values,
          error,
        }),
      );

    if (!parsed.success || !isPlausibleName(values.name)) {
      await reject(s.invalidName);
      return;
    }

    const phone = values.phone.replace(/\D/g, '');
    if (phone.length < 10 || phone.length > 15) {
      await reject(s.invalidPhone);
      return;
    }

    const patient = await findOrCreatePatient(phone, {
      name: values.name.trim(),
      ...(parsed.data.language ? { language: parsed.data.language } : {}),
    });
    if (!patient.name) await setPatientName(patient.id, values.name.trim());

    const result = await bookSlot(doctor, patient.id, date, slotStart);

    if (!result.ok) {
      const message = {
        TAKEN: s.slotTaken,
        NOT_A_SLOT: s.slotNotValid,
        IN_PAST: s.slotInPast,
        ON_LEAVE: s.onLeaveShort,
        PATIENT_HAS_SLOT: s.patientHasSlot,
      }[result.reason];
      await reject(message);
      return;
    }

    const when = formatTimeForPatient(slotStart, doctor.timezone);
    if (result.alreadyExisted) {
      res.redirect(
        302,
        `/app/calendar?date=${rawDate}&flash=${encodeURIComponent(s.patientHasSlot)}`,
      );
      return;
    }

    // Written after creation rather than threaded through issueToken/bookSlot:
    // a remark is not part of the booking's correctness, and keeping it out of
    // those functions leaves their signatures — and their race guarantees —
    // alone. Only on a fresh row, so a re-submit never clobbers an existing one.
    if (parsed.data.notes) {
      await prisma.appointment.update({
        where: { id: result.appointment.id },
        data: { notes: parsed.data.notes },
      });
    }

    // The same confirmation the SLOT conversation flow will send once built.
    await enqueueOutbound({
      to: patient.phone,
      text: t(patient.language, 'slotBooked', {
        doctorName: doctor.name,
        clinicName: doctor.clinicName,
        date: formatDateForPatient(date),
        time: when,
      }),
      templateName: 'slotBooked',
      ...(doctor.whatsappPhoneNumberId
        ? { channelAddress: doctor.whatsappPhoneNumberId }
        : {}),
    });

    res.redirect(
      302,
      `/app/calendar?date=${rawDate}&flash=${encodeURIComponent(
        s.slotBooked(when, values.name.trim()),
      )}`,
    );
  },
);

// ---- walk-in booking ----

doctorConsoleRouter.get('/app/queue/walk-in', requireDoctorAuth, async (req, res) => {
  const doctor = req.doctor!;
  res.type('html').send(
    walkInPage({
      doctor,
      queueCount: await waitingCount(doctor.id, doctor.timezone),
      csrfToken: req.csrfToken ?? '',
    }),
  );
});

const walkInBody = z.object({
  name: z.string().trim().min(1),
  phone: z.string().trim().min(1),
  language: z.enum(['EN', 'KN']).optional(),
  notes: z.string().trim().max(500).optional(),
});

doctorConsoleRouter.post(
  '/app/queue/walk-in',
  requireDoctorAuth,
  requireFormCsrf,
  async (req, res) => {
    const doctor = req.doctor!;
    const s = c(doctor.defaultLanguage);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsed = walkInBody.safeParse(body);

    const values = {
      name: typeof body['name'] === 'string' ? body['name'] : '',
      phone: typeof body['phone'] === 'string' ? body['phone'] : '',
      language: typeof body['language'] === 'string' ? body['language'] : undefined,
      notes: typeof body['notes'] === 'string' ? body['notes'] : '',
    };

    const reject = async (error: string) =>
      res.type('html').send(
        walkInPage({
          doctor,
          queueCount: await waitingCount(doctor.id, doctor.timezone),
          csrfToken: req.csrfToken ?? '',
          values,
          error,
        }),
      );

    if (!parsed.success || !isPlausibleName(values.name)) {
      await reject(s.invalidName);
      return;
    }

    // Stored the way WhatsApp delivers them: E.164 digits, no '+'. A number
    // typed with spaces or a leading + must land in the same shape as one that
    // arrived over the webhook, or the same person becomes two patients.
    const phone = values.phone.replace(/\D/g, '');
    if (phone.length < 10 || phone.length > 15) {
      await reject(s.invalidPhone);
      return;
    }

    const patient = await findOrCreatePatient(phone, {
      name: values.name.trim(),
      ...(parsed.data.language ? { language: parsed.data.language } : {}),
    });

    // Name only fills a blank; a patient who told the bot their own name keeps it.
    if (!patient.name) await setPatientName(patient.id, values.name.trim());

    const result = await issueToken(doctor, patient.id, clinicToday(doctor.timezone));

    if (!result.ok) {
      const message =
        result.reason === 'CAP_REACHED'
          ? s.capReached
          : result.reason === 'LIST_CLOSED'
            ? s.listClosedShort
            : s.onLeaveShort;
      await reject(message);
      return;
    }

    const token = result.appointment.tokenNumber ?? 0;
    if (result.alreadyExisted) {
      res.redirect(302, `/app/queue?flash=${encodeURIComponent(s.alreadyHasToken(token))}`);
      return;
    }

    // Written after creation rather than threaded through issueToken/bookSlot:
    // a remark is not part of the booking's correctness, and keeping it out of
    // those functions leaves their signatures — and their race guarantees —
    // alone. Only on a fresh row, so a re-submit never clobbers an existing one.
    if (parsed.data.notes) {
      await prisma.appointment.update({
        where: { id: result.appointment.id },
        data: { notes: parsed.data.notes },
      });
    }

    // Same confirmation a self-booking patient receives, in their language.
    const position = await computePosition(result.appointment, doctor);
    await enqueueOutbound({
      to: patient.phone,
      text: t(patient.language, 'tokenBooked', {
        tokenNumber: token,
        date: formatDateForPatient(result.appointment.date),
        doctorName: doctor.name,
        nowServing: nowServingLabel(patient.language, position.nowServingToken),
        ahead: position.ahead,
        eta: formatWait(Math.round(position.etaMins)),
      }),
      templateName: 'tokenBooked',
      ...(doctor.whatsappPhoneNumberId
        ? { channelAddress: doctor.whatsappPhoneNumberId }
        : {}),
    });

    res.redirect(
      302,
      `/app/queue?flash=${encodeURIComponent(s.tokenIssued(token, values.name.trim()))}`,
    );
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

    // Only one patient may be in the room at a time. Two concurrent
    // IN_PROGRESS rows make startedAt ambiguous, so the consult durations that
    // feed avgConsultTimeMins — and therefore every patient's ETA — become
    // meaningless. The UI hides the relevant buttons, but a form post can be
    // replayed or crafted, so the rule is enforced here too.
    if (status === 'IN_PROGRESS') {
      const alreadyInRoom = await prisma.appointment.findFirst({
        where: {
          doctorId: doctor.id,
          date: appointment.date,
          status: 'IN_PROGRESS',
          id: { not: appointment.id },
        },
        select: { tokenNumber: true },
      });

      if (alreadyInRoom) {
        const token = alreadyInRoom.tokenNumber;
        res.redirect(
          302,
          `/app/queue?flash=${encodeURIComponent(
            `Finish with token ${token ?? '—'} before calling the next patient`,
          )}`,
        );
        return;
      }
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
      queueCount: await waitingCount(doctor.id, doctor.timezone),
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
  const [patients, queueCount] = await Promise.all([
    listPatientsForDoctor(doctor.id),
    waitingCount(doctor.id, doctor.timezone),
  ]);
  res
    .type('html')
    .send(patientsPage({ doctor, patients, queueCount, csrfToken: req.csrfToken ?? '' }));
});

doctorConsoleRouter.get('/app/patients/:id', requireDoctorAuth, async (req, res) => {
  const doctor = req.doctor!;
  const { patient, appointments, totalVisits } = await patientHistory(
    doctor.id,
    req.params['id'] ?? '',
  );

  // Scoped by construction: patientHistory filters on doctorId, so a patient who
  // has never booked with this doctor comes back with an empty list.
  if (!patient || appointments.length === 0) {
    notFound(res, 'No patient of yours with that id.');
    return;
  }

  res.type('html').send(
    patientDetailPage({
      doctor,
      patient,
      appointments,
      totalVisits,
      accepted: storage().capabilities.acceptedTypes,
      maxBytes: storage().capabilities.maxBytes,
      queueCount: await waitingCount(doctor.id, doctor.timezone),
      csrfToken: req.csrfToken ?? '',
      ...(typeof req.query['flash'] === 'string' ? { flash: req.query['flash'] } : {}),
      ...(typeof req.query['error'] === 'string' ? { error: req.query['error'] } : {}),
    }),
  );
});

// ---- patient documents ----

/**
 * Upload a reference document against one visit.
 *
 * The file arrives as a data: URI in a form field rather than as multipart —
 * there is no multipart parser in the stack, and the profile photo already
 * established the pattern. addDocument does the validating; this route only
 * decides where to send the doctor afterwards.
 */
doctorConsoleRouter.post(
  '/app/appointment/:appointmentId/document',
  requireDoctorAuth,
  requireFormCsrf,
  async (req, res) => {
    const doctor = req.doctor!;
    const s = c(doctor.defaultLanguage);
    const body = (req.body ?? {}) as Record<string, unknown>;

    // Needed for the redirect target, and it doubles as the ownership check:
    // findFirst is scoped to this doctor, so another clinic's id is simply absent.
    const appointment = await prisma.appointment.findFirst({
      where: { id: req.params['appointmentId'] ?? '', doctorId: doctor.id },
      select: { id: true, patientId: true },
    });
    if (!appointment) {
      notFound(res, 'Appointment not found.');
      return;
    }

    const result = await addDocument({
      doctorId: doctor.id,
      appointmentId: appointment.id,
      filename: body['filename'],
      dataUri: body['file'],
    });

    const back = `/app/patients/${appointment.patientId}`;
    if (result.ok) {
      res.redirect(302, `${back}?flash=${encodeURIComponent(s.documentAdded)}`);
      return;
    }

    const message =
      result.reason === 'TYPE_NOT_ALLOWED'
        ? s.uploadFailedType
        : result.reason === 'TOO_LARGE'
          ? s.uploadFailedSize
          : result.reason === 'TOO_MANY'
            ? s.uploadFailedTooMany
            : s.uploadFailedGeneric;
    res.redirect(302, `${back}?error=${encodeURIComponent(message)}`);
  },
);

/**
 * Download one document.
 *
 * Always as an attachment, never inline. These bytes are user-supplied and are
 * served from our own origin, so an inline render would let a crafted file run
 * against the doctor's session cookie — the same reason the profile photo
 * refuses SVG. nosniff stops the browser second-guessing the declared type.
 */
doctorConsoleRouter.get('/app/document/:id', requireDoctorAuth, async (req, res) => {
  const doctor = req.doctor!;
  const doc = await getDocumentForDoctor(doctor.id, req.params['id'] ?? '');
  if (!doc) {
    notFound(res, 'No document of yours with that id.');
    return;
  }

  const signed = await storage().signedUrl(
    { storageKey: doc.storageKey, inlineData: doc.inlineData },
    { filename: doc.filename, contentType: doc.contentType },
  );
  if (signed) {
    // Object storage: hand the browser a short-lived URL rather than proxying.
    res.redirect(302, signed);
    return;
  }

  if (!doc.inlineData) {
    notFound(res, 'That document is no longer available.');
    return;
  }

  // Quotes and backslashes would break out of the header's quoted-string; the
  // filename is whatever the uploader's file was called.
  const safeName = doc.filename.replace(/["\\]/g, '');
  res
    .status(200)
    .set({
      'Content-Type': doc.contentType,
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'X-Content-Type-Options': 'nosniff',
      // A medical record has no business in a shared cache.
      'Cache-Control': 'private, no-store',
    })
    .send(Buffer.from(doc.inlineData, 'base64'));
});

doctorConsoleRouter.post(
  '/app/document/:id/delete',
  requireDoctorAuth,
  requireFormCsrf,
  async (req, res) => {
    const doctor = req.doctor!;
    const s = c(doctor.defaultLanguage);

    // Read the owning patient before the row goes, so the redirect lands back on
    // the page the doctor was looking at.
    const doc = await prisma.document.findFirst({
      where: { id: req.params['id'] ?? '', doctorId: doctor.id },
      select: { id: true, appointment: { select: { patientId: true } } },
    });
    if (!doc) {
      notFound(res, 'No document of yours with that id.');
      return;
    }

    await deleteDocument(doctor.id, doc.id);
    res.redirect(
      302,
      `/app/patients/${doc.appointment.patientId}?flash=${encodeURIComponent(s.documentRemoved)}`,
    );
  },
);

// ---- settings ----

doctorConsoleRouter.get('/app/settings', requireDoctorAuth, async (req, res) => {
  const doctor = req.doctor!;
  const s = c(doctor.defaultLanguage);
  res.type('html').send(
    settingsPage({
      doctor,
      queueCount: await waitingCount(doctor.id, doctor.timezone),
      csrfToken: req.csrfToken ?? '',
      ...(req.query['flash'] === 'saved' ? { flash: s.profileSaved } : {}),
    }),
  );
});

/**
 * A stored photo is rendered back into an <img src>, so the value has to be
 * proven safe rather than trusted because our own script produced it — a form
 * post can carry anything.
 *
 * Only raster data: URIs are accepted. SVG is deliberately excluded even though
 * it is an image type: it can carry script, and this value is echoed into a
 * page. `javascript:` and remote URLs fail the same check.
 */
const PHOTO_PREFIX = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
const PHOTO_MAX_BYTES = 400_000;

function validPhoto(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  if (value.length > PHOTO_MAX_BYTES) return null;
  return PHOTO_PREFIX.test(value) ? value : null;
}

const profileBody = z.object({
  name: z.string().trim().min(2, 'Your name needs at least 2 characters').max(80),
  clinicName: z.string().trim().min(2, 'Clinic name needs at least 2 characters').max(120),
  specialty: z.string().trim().max(80).optional(),
  qualification: z.string().trim().max(120).optional(),
});

doctorConsoleRouter.post(
  '/app/settings/profile',
  requireDoctorAuth,
  requireFormCsrf,
  async (req, res) => {
    const doctor = req.doctor!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsed = profileBody.safeParse(body);

    const render = (extra: { flash?: string; error?: string }) =>
      prisma.doctor
        .findUnique({ where: { id: doctor.id } })
        .then(async (fresh) =>
          res.type('html').send(
            settingsPage({
              doctor: fresh ?? doctor,
              queueCount: await waitingCount(doctor.id, doctor.timezone),
              csrfToken: req.csrfToken ?? '',
              ...extra,
            }),
          ),
        );

    if (!parsed.success) {
      await render({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
      return;
    }

    const submittedPhoto = body['photo'];
    const removing = body['removePhoto'] === '1';

    // Distinguish "no new photo chosen" (leave it alone) from "remove it".
    let photoUpdate: { photo: string | null } | Record<string, never> = {};
    if (removing) {
      photoUpdate = { photo: null };
    } else if (typeof submittedPhoto === 'string' && submittedPhoto !== '') {
      const photo = validPhoto(submittedPhoto);
      if (!photo) {
        await render({ error: 'That image could not be used. Try a JPG, PNG or WebP under 400KB.' });
        return;
      }
      photoUpdate = { photo };
    }

    await prisma.doctor.update({
      where: { id: doctor.id },
      data: {
        name: parsed.data.name,
        clinicName: parsed.data.clinicName,
        specialty: parsed.data.specialty || null,
        qualification: parsed.data.qualification || null,
        ...photoUpdate,
      },
    });

    res.redirect(302, '/app/settings?flash=saved');
  },
);

// ---- reports ----

doctorConsoleRouter.get('/app/reports', requireDoctorAuth, async (req, res) => {
  const doctor = req.doctor!;
  const requested = Number.parseInt(String(req.query['days'] ?? ''), 10);
  const days = [7, 30, 90].includes(requested) ? requested : 30;

  const [report, queueCount] = await Promise.all([
    buildReport(doctor, days),
    waitingCount(doctor.id, doctor.timezone),
  ]);
  res
    .type('html')
    .send(reportsPage({ doctor, report, days, queueCount, csrfToken: req.csrfToken ?? '' }));
});
