import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { clinicToday } from '../utils/time';
import { ClinicFullError, clinicForNewDoctor } from '../domain/clinics';
import { getDoctorByApiKey } from '../domain/doctors';
import type { WorkingHours } from '../domain/slots';
import { buildWorkingHours as buildHours, workingHoursToText } from '../domain/workingHours';
import { normalisePhone, phoneError } from '../domain/phone';
import { requireAdminSession, requireDoctorAuth, requireFormCsrf } from './middleware/auth';
import { createRateLimiter } from './middleware/rateLimit';
import {
  apiKeyFingerprint,
  clearAdminSessionCookie,
  clearSessionCookie,
  newCsrfToken,
  sessionExpiry,
  setAdminSessionCookie,
  setSessionCookie,
  signAdminSession,
  signSession,
} from './middleware/session';
import { safeNextPath } from './web/negotiate';
import {
  DAYS,
  type Day,
  type DoctorFormValues,
  doctorDetailPage,
  doctorFormPage,
  doctorsPage,
  emptyHours,
  errorPage,
  loginPage,
} from './web/views';

/**
 * Operator console. Server-rendered HTML against real <form> posts, so it works
 * without JavaScript; requireFormCsrf carries the token in a hidden field since
 * a form cannot set the X-CSRF-Token header the JSON API uses.
 */
export const appConsoleRouter = Router();

/**
 * Brute-force guard on the only route where a secret is submitted. Counts all
 * attempts, not just failures, which is the conservative direction: a
 * successful login costs one of the ten.
 */
const loginLimiter = createRateLimiter({
  windowMs: 15 * 60_000,
  max: 10,
  // This is a browser page, so refuse in HTML rather than the default JSON.
  onLimit: (_req, res, retryAfterSecs) => {
    const mins = Math.max(1, Math.ceil(retryAfterSecs / 60));
    res
      .status(429)
      .type('html')
      .send(loginPage({ error: `Too many attempts. Try again in about ${mins} minute${mins === 1 ? '' : 's'}.` }));
  },
});

// ---- working hours <-> "09:30-13:00, 17:00-20:00" ----
// The parser, formatter and Window type now live in domain/workingHours.ts, so
// the doctor console and the admin JSON API validate identically.

function hoursFromDoctor(workingHours: unknown): Record<Day, string> {
  return workingHoursToText(workingHours) as Record<Day, string>;
}

function hoursFromBody(body: Record<string, unknown>): Record<Day, string> {
  const out = emptyHours();
  for (const day of DAYS) {
    const raw = body[`hours_${day}`];
    out[day] = typeof raw === 'string' ? raw : '';
  }
  return out;
}

function str(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  return typeof v === 'string' ? v.trim() : '';
}

function valuesFromBody(body: Record<string, unknown>): DoctorFormValues {
  return {
    name: str(body, 'name'),
    clinicName: str(body, 'clinicName'),
    phone: str(body, 'phone'),
    bookingMode: str(body, 'bookingMode') || 'TOKEN',
    dailyTokenCap: str(body, 'dailyTokenCap'),
    consultDurationMins: str(body, 'consultDurationMins'),
    defaultLanguage: str(body, 'defaultLanguage') || 'EN',
    timezone: str(body, 'timezone'),
    whatsappPhoneNumberId: str(body, 'whatsappPhoneNumberId'),
    whatsappNumber: str(body, 'whatsappNumber'),
    missedCallNumber: str(body, 'missedCallNumber'),
    hours: hoursFromBody(body),
  };
}

const doctorInput = z.object({
  name: z.string().min(2, 'Doctor name needs at least 2 characters'),
  clinicName: z.string().min(2, 'Clinic name needs at least 2 characters'),
  phone: z.string().min(6, 'Phone needs at least 6 digits'),
  bookingMode: z.enum(['TOKEN', 'SLOT', 'HYBRID']),
  dailyTokenCap: z.coerce.number().int().min(1).max(500),
  consultDurationMins: z.coerce.number().int().min(1).max(180),
  defaultLanguage: z.enum(['EN', 'KN']),
  timezone: z.string().min(1),
});

// ---- login ----

appConsoleRouter.get('/app/login', (req, res) => {
  const next = safeNextPath(typeof req.query['next'] === 'string' ? req.query['next'] : null);
  res.type('html').send(loginPage({ next: next ?? undefined }));
});

/**
 * One login page, two audiences. A doctor's key is prefixed `dk_` (see the
 * generator in this file and in admin.ts), so the key's own shape selects which
 * credential is being presented — no second page, and no way to probe whether a
 * given string is "an admin key" versus "a doctor key" beyond what the prefix
 * already announces.
 */
appConsoleRouter.post('/app/login', loginLimiter, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  // Trimmed because the key is always pasted, and a copied line routinely
  // carries a trailing newline or space. A key that differs only by
  // surrounding whitespace is a paste artefact, never a real credential.
  const submitted = typeof body['key'] === 'string' ? body['key'].trim() : '';
  const next = safeNextPath(typeof body['next'] === 'string' ? body['next'] : null);

  const reject = (error = 'That key was not recognised.') =>
    res
      .status(401)
      .type('html')
      .send(loginPage({ error, next: next ?? undefined }));

  if (submitted.startsWith('dk_')) {
    const doctor = await getDoctorByApiKey(submitted);
    if (!doctor) {
      reject();
      return;
    }
    // Neither doctorFromCookie nor getDoctorByApiKey consults status, so this
    // is the one place a disabled account is actually turned away.
    if (doctor.status !== 'ACTIVE') {
      reject('That account is disabled. Contact the clinic administrator.');
      return;
    }

    setSessionCookie(
      res,
      signSession({
        d: doctor.id,
        k: apiKeyFingerprint(doctor.apiKey),
        exp: sessionExpiry(),
        csrf: newCsrfToken(),
      }),
    );
    res.redirect(302, next ?? '/app/queue');
    return;
  }

  const expected = Buffer.from(env.ADMIN_API_KEY);
  const provided = Buffer.from(submitted);
  const ok =
    provided.length === expected.length && crypto.timingSafeEqual(provided, expected);

  if (!ok) {
    reject();
    return;
  }

  setAdminSessionCookie(
    res,
    signAdminSession({
      r: 'admin',
      k: apiKeyFingerprint(env.ADMIN_API_KEY),
      exp: sessionExpiry(),
      csrf: newCsrfToken(),
    }),
  );
  res.redirect(302, next ?? '/app/doctors');
});

/** Doctors get their own logout: a different cookie, and a different guard. */
appConsoleRouter.post(
  '/app/doctor-logout',
  requireDoctorAuth,
  requireFormCsrf,
  (_req, res) => {
    clearSessionCookie(res);
    res.redirect(302, '/app/login');
  },
);

appConsoleRouter.post('/app/logout', requireAdminSession, requireFormCsrf, (_req, res) => {
  clearAdminSessionCookie(res);
  res.redirect(302, '/app/login');
});

appConsoleRouter.get('/app', requireAdminSession, (_req, res) => {
  res.redirect(302, '/app/doctors');
});

// ---- list ----

appConsoleRouter.get('/app/doctors', requireAdminSession, async (req, res) => {
  const doctors = await prisma.doctor.findMany({ orderBy: { createdAt: 'desc' } });
  const flash = typeof req.query['flash'] === 'string' ? req.query['flash'] : undefined;
  res
    .type('html')
    .send(doctorsPage({ doctors, csrfToken: req.adminCsrfToken ?? '', flash }));
});

// ---- create ----

appConsoleRouter.get('/app/doctors/new', requireAdminSession, (req, res) => {
  res.type('html').send(
    doctorFormPage({
      mode: 'create',
      csrfToken: req.adminCsrfToken ?? '',
      values: {
        name: '',
        clinicName: '',
        phone: '',
        bookingMode: 'TOKEN',
        dailyTokenCap: '40',
        consultDurationMins: '10',
        defaultLanguage: 'EN',
        timezone: 'Asia/Kolkata',
        whatsappPhoneNumberId: '',
        whatsappNumber: '',
        missedCallNumber: '',
        hours: emptyHours(),
      },
    }),
  );
});

appConsoleRouter.post(
  '/app/doctors/new',
  requireAdminSession,
  requireFormCsrf,
  async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const values = valuesFromBody(body);
    const csrfToken = req.adminCsrfToken ?? '';

    const reject = (error: string, status = 400) =>
      res
        .status(status)
        .type('html')
        .send(doctorFormPage({ mode: 'create', values, csrfToken, error }));

    const parsed = doctorInput.safeParse(values);
    if (!parsed.success) {
      reject(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }

    let workingHours: WorkingHours;
    try {
      workingHours = buildWorkingHours(values.hours);
    } catch (err) {
      reject(err instanceof Error ? err.message : 'Invalid working hours');
      return;
    }

    const data = parsed.data;

    // Stored digits-only: the console renders it as `+${whatsappNumber}` and
    // bookingLink builds the wa.me URL from it. Blank is allowed — a clinic may
    // not have its number yet — but a malformed one is refused rather than
    // stored as something that renders a broken link.
    let whatsappNumber: string | null = null;
    if (values.whatsappNumber) {
      const phone = normalisePhone(values.whatsappNumber);
      if (!phone.ok) {
        reject(phoneError(phone.reason));
        return;
      }
      whatsappNumber = phone.digits;
    }

    // Attach to a clinic, creating one if this is its first doctor. Doctors
    // typed with the same clinic name join the same practice and share its
    // WhatsApp number, which is what lets one number serve several doctors.
    let clinic;
    try {
      clinic = await clinicForNewDoctor({
        clinicName: data.clinicName,
        ...(whatsappNumber ? { whatsappNumber } : {}),
      });
    } catch (err) {
      if (err instanceof ClinicFullError) {
        reject(err.message);
        return;
      }
      throw err;
    }

    try {
      const doctor = await prisma.doctor.create({
        data: {
          name: data.name,
          clinicName: clinic.name,
          clinicId: clinic.id,
          phone: data.phone,
          bookingMode: data.bookingMode,
          bookingModeLockedAt: new Date(),
          dailyTokenCap: data.dailyTokenCap,
          consultDurationMins: data.consultDurationMins,
          // Seed the rolling average with the doctor's own estimate; it
          // self-corrects from real consult durations.
          avgConsultTimeMins: data.consultDurationMins,
          consultSampleCount: 0,
          defaultLanguage: data.defaultLanguage,
          timezone: data.timezone,
          workingHours: workingHours as object,
          ...(values.whatsappPhoneNumberId
            ? { whatsappPhoneNumberId: values.whatsappPhoneNumberId }
            : {}),
          ...(whatsappNumber ? { whatsappNumber } : {}),
          ...(values.missedCallNumber ? { missedCallNumber: values.missedCallNumber } : {}),
          apiKey: `dk_${crypto.randomBytes(24).toString('hex')}`,
        },
      });
      res.redirect(302, `/app/doctors/${doctor.id}?flash=Doctor+created`);
    } catch {
      // The unique constraints here are whatsappPhoneNumberId and
      // missedCallNumber; both are operator-entered, so say so plainly.
      reject('That WhatsApp number id or missed-call number is already used by another doctor.', 409);
    }
  },
);

// ---- detail ----

appConsoleRouter.get('/app/doctors/:id', requireAdminSession, async (req, res) => {
  const doctor = await prisma.doctor.findUnique({ where: { id: req.params.id ?? '' } });
  if (!doctor) {
    res
      .status(404)
      .type('html')
      .send(errorPage({ title: 'Not found', message: 'No doctor with that id.' }));
    return;
  }

  const bookedToday = await prisma.appointment.count({
    where: {
      doctorId: doctor.id,
      date: clinicToday(doctor.timezone),
      status: { notIn: ['CANCELLED', 'NO_SHOW'] },
    },
  });

  const flash = typeof req.query['flash'] === 'string' ? req.query['flash'] : undefined;
  const newApiKey = typeof req.query['key'] === 'string' ? req.query['key'] : undefined;

  res.type('html').send(
    doctorDetailPage({
      doctor,
      hours: hoursFromDoctor(doctor.workingHours),
      bookedToday,
      csrfToken: req.adminCsrfToken ?? '',
      flash,
      newApiKey,
    }),
  );
});

// ---- edit ----

appConsoleRouter.get('/app/doctors/:id/edit', requireAdminSession, async (req, res) => {
  const doctor = await prisma.doctor.findUnique({ where: { id: req.params.id ?? '' } });
  if (!doctor) {
    res
      .status(404)
      .type('html')
      .send(errorPage({ title: 'Not found', message: 'No doctor with that id.' }));
    return;
  }

  res.type('html').send(
    doctorFormPage({
      mode: 'edit',
      doctorId: doctor.id,
      csrfToken: req.adminCsrfToken ?? '',
      values: {
        name: doctor.name,
        clinicName: doctor.clinicName,
        phone: doctor.phone,
        bookingMode: doctor.bookingMode,
        dailyTokenCap: String(doctor.dailyTokenCap),
        consultDurationMins: String(doctor.consultDurationMins),
        defaultLanguage: doctor.defaultLanguage,
        timezone: doctor.timezone,
        whatsappPhoneNumberId: doctor.whatsappPhoneNumberId ?? '',
        whatsappNumber: doctor.whatsappNumber ?? '',
        missedCallNumber: doctor.missedCallNumber ?? '',
        hours: hoursFromDoctor(doctor.workingHours),
      },
    }),
  );
});

appConsoleRouter.post(
  '/app/doctors/:id/edit',
  requireAdminSession,
  requireFormCsrf,
  async (req, res) => {
    const id = req.params.id ?? '';
    const existing = await prisma.doctor.findUnique({ where: { id } });
    if (!existing) {
      res
        .status(404)
        .type('html')
        .send(errorPage({ title: 'Not found', message: 'No doctor with that id.' }));
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    // bookingMode is write-once, so the edit form renders it disabled and the
    // browser omits it. Take the stored value rather than trusting the body.
    const values = { ...valuesFromBody(body), bookingMode: existing.bookingMode };
    const csrfToken = req.adminCsrfToken ?? '';

    const reject = (error: string, status = 400) =>
      res
        .status(status)
        .type('html')
        .send(doctorFormPage({ mode: 'edit', doctorId: id, values, csrfToken, error }));

    const parsed = doctorInput.safeParse(values);
    if (!parsed.success) {
      reject(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }

    let workingHours: WorkingHours;
    try {
      workingHours = buildWorkingHours(values.hours);
    } catch (err) {
      reject(err instanceof Error ? err.message : 'Invalid working hours');
      return;
    }

    const data = parsed.data;

    // Stored digits-only: the console renders it as `+${whatsappNumber}` and
    // bookingLink builds the wa.me URL from it. Blank is allowed — a clinic may
    // not have its number yet — but a malformed one is refused rather than
    // stored as something that renders a broken link.
    let whatsappNumber: string | null = null;
    if (values.whatsappNumber) {
      const phone = normalisePhone(values.whatsappNumber);
      if (!phone.ok) {
        reject(phoneError(phone.reason));
        return;
      }
      whatsappNumber = phone.digits;
    }

    try {
      await prisma.doctor.update({
        where: { id },
        data: {
          name: data.name,
          clinicName: data.clinicName,
          phone: data.phone,
          dailyTokenCap: data.dailyTokenCap,
          consultDurationMins: data.consultDurationMins,
          defaultLanguage: data.defaultLanguage,
          timezone: data.timezone,
          workingHours: workingHours as object,
          whatsappPhoneNumberId: values.whatsappPhoneNumberId || null,
          whatsappNumber,
          missedCallNumber: values.missedCallNumber || null,
        },
      });
      res.redirect(302, `/app/doctors/${id}?flash=Changes+saved`);
    } catch {
      reject('That WhatsApp number id or missed-call number is already used by another doctor.', 409);
    }
  },
);

// ---- status toggle / key rotation ----

appConsoleRouter.post(
  '/app/doctors/:id/toggle-status',
  requireAdminSession,
  requireFormCsrf,
  async (req, res) => {
    const id = req.params.id ?? '';
    const doctor = await prisma.doctor.findUnique({ where: { id } });
    if (!doctor) {
      res
        .status(404)
        .type('html')
        .send(errorPage({ title: 'Not found', message: 'No doctor with that id.' }));
      return;
    }

    const status = doctor.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    await prisma.doctor.update({ where: { id }, data: { status } });
    res.redirect(302, `/app/doctors/${id}?flash=Doctor+${status.toLowerCase()}`);
  },
);

appConsoleRouter.post(
  '/app/doctors/:id/rotate-key',
  requireAdminSession,
  requireFormCsrf,
  async (req, res) => {
    const id = req.params.id ?? '';
    const apiKey = `dk_${crypto.randomBytes(24).toString('hex')}`;
    const updated = await prisma.doctor
      .update({ where: { id }, data: { apiKey } })
      .catch(() => null);

    if (!updated) {
      res
        .status(404)
        .type('html')
        .send(errorPage({ title: 'Not found', message: 'No doctor with that id.' }));
      return;
    }

    // Shown once, via the redirect, then never again.
    res.redirect(302, `/app/doctors/${id}?key=${encodeURIComponent(apiKey)}`);
  },
);

/** Operator-facing labels are the bare day key upper-cased, as they always were. */
const ADMIN_DAY_LABELS = Object.fromEntries(
  DAYS.map((day) => [day, day.toUpperCase()]),
) as Record<Day, string>;

function buildWorkingHours(hours: Record<Day, string>): WorkingHours {
  return buildHours(hours, ADMIN_DAY_LABELS);
}
