import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { normalisePhone, phoneError } from '../domain/phone';
import { parseWorkingHours } from '../domain/slots';
import { formatDateOnly, parseDateOnly } from '../utils/time';
import { requireAdminKey } from './middleware/auth';

/**
 * Onboarding / admin routes (requirement 2). booking_mode is set here and
 * nowhere else — never over WhatsApp — and is write-once: changing it later
 * would strand patients mid-conversation in a flow that no longer exists.
 */
export const adminRouter = Router();

const windowSchema = z.object({
  start: z.string().regex(/^\d{1,2}:\d{2}$/),
  end: z.string().regex(/^\d{1,2}:\d{2}$/),
});

const workingHoursSchema = z
  .object({
    mon: z.array(windowSchema).optional(),
    tue: z.array(windowSchema).optional(),
    wed: z.array(windowSchema).optional(),
    thu: z.array(windowSchema).optional(),
    fri: z.array(windowSchema).optional(),
    sat: z.array(windowSchema).optional(),
    sun: z.array(windowSchema).optional(),
  })
  .default({});

/**
 * `.strict()` throughout: Zod strips unknown keys by default, so a misspelled or
 * not-yet-deployed field was accepted, discarded, and reported as `updated: true`.
 * A caller cannot tell that from a real write. These are JSON API bodies with no
 * incidental fields, so rejecting the unexpected costs nothing.
 *
 * The console's form posts are deliberately NOT strict — a browser sends `_csrf`
 * and other extras that must keep being ignored.
 */
const createDoctorBody = z.object({
  name: z.string().min(2),
  clinicName: z.string().min(2),
  phone: z.string().min(6),
  bookingMode: z.enum(['TOKEN', 'SLOT', 'HYBRID']),
  whatsappPhoneNumberId: z.string().optional(),
  /** Dialable form, for the wa.me link and QR. Normalised to digits on write. */
  whatsappNumber: z.string().optional(),
  dailyTokenCap: z.coerce.number().int().min(1).max(500).optional(),
  consultDurationMins: z.coerce.number().int().min(1).max(180).optional(),
  defaultLanguage: z.enum(['EN', 'KN']).optional(),
  timezone: z.string().optional(),
  workingHours: workingHoursSchema.optional(),
}).strict();

adminRouter.post('/admin/doctor', requireAdminKey, async (req, res) => {
  const parsed = createDoctorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
    return;
  }

  const body = parsed.data;

  // Stored digits-only: the console renders it as `+${whatsappNumber}` and
  // bookingLink builds the wa.me URL from it.
  let whatsappNumber: string | undefined;
  if (body.whatsappNumber !== undefined) {
    const phone = normalisePhone(body.whatsappNumber);
    if (!phone.ok) {
      res.status(400).json({ error: phoneError(phone.reason) });
      return;
    }
    whatsappNumber = phone.digits;
  }

  const apiKey = `dk_${crypto.randomBytes(24).toString('hex')}`;
  const consultDurationMins = body.consultDurationMins ?? 10;

  const doctor = await prisma.doctor.create({
    data: {
      name: body.name,
      clinicName: body.clinicName,
      phone: body.phone,
      bookingMode: body.bookingMode,
      bookingModeLockedAt: new Date(),
      ...(body.whatsappPhoneNumberId
        ? { whatsappPhoneNumberId: body.whatsappPhoneNumberId }
        : {}),
      ...(whatsappNumber ? { whatsappNumber } : {}),
      dailyTokenCap: body.dailyTokenCap ?? 40,
      consultDurationMins,
      // Seed the rolling average with the doctor's own estimate; it self-corrects
      // from real consult durations after the first few "Done" actions.
      avgConsultTimeMins: consultDurationMins,
      consultSampleCount: 0,
      workingHours: (body.workingHours ?? {}) as object,
      ...(body.defaultLanguage ? { defaultLanguage: body.defaultLanguage } : {}),
      ...(body.timezone ? { timezone: body.timezone } : {}),
      apiKey,
    },
  });

  res.status(201).json({
    id: doctor.id,
    name: doctor.name,
    clinicName: doctor.clinicName,
    bookingMode: doctor.bookingMode,
    // Shown once, on creation.
    apiKey: doctor.apiKey,
  });
});

/** Read a doctor's config (no patient data). */
adminRouter.get('/admin/doctor/:id', requireAdminKey, async (req, res) => {
  const doctor = await prisma.doctor.findUnique({ where: { id: req.params['id'] ?? '' } });
  if (!doctor) {
    res.status(404).json({ error: 'Doctor not found' });
    return;
  }

  res.json({
    id: doctor.id,
    name: doctor.name,
    clinicName: doctor.clinicName,
    phone: doctor.phone,
    bookingMode: doctor.bookingMode,
    bookingModeLockedAt: doctor.bookingModeLockedAt,
    whatsappPhoneNumberId: doctor.whatsappPhoneNumberId,
    whatsappNumber: doctor.whatsappNumber,
    missedCallNumber: doctor.missedCallNumber,
    dailyTokenCap: doctor.dailyTokenCap,
    consultDurationMins: doctor.consultDurationMins,
    avgConsultTimeMins: Number(doctor.avgConsultTimeMins.toFixed(1)),
    consultSampleCount: doctor.consultSampleCount,
    workingHours: parseWorkingHours(doctor.workingHours),
    leaveDates: doctor.leaveDates.map(formatDateOnly),
    defaultLanguage: doctor.defaultLanguage,
    timezone: doctor.timezone,
  });
});

const bookingModeBody = z.object({
  bookingMode: z.enum(['TOKEN', 'SLOT', 'HYBRID']),
  /** Explicit override for the write-once rule. */
  force: z.boolean().optional(),
}).strict();

adminRouter.post('/admin/doctor/:id/booking-mode', requireAdminKey, async (req, res) => {
  const parsed = bookingModeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'bookingMode must be TOKEN, SLOT or HYBRID' });
    return;
  }

  const doctor = await prisma.doctor.findUnique({ where: { id: req.params['id'] ?? '' } });
  if (!doctor) {
    res.status(404).json({ error: 'Doctor not found' });
    return;
  }

  if (doctor.bookingModeLockedAt && !parsed.data.force) {
    res.status(409).json({
      error: 'booking_mode is set at onboarding and cannot be changed',
      currentMode: doctor.bookingMode,
      lockedAt: doctor.bookingModeLockedAt,
      hint: 'Re-send with { "force": true } if you accept that in-flight conversations will be reset.',
    });
    return;
  }

  const updated = await prisma.doctor.update({
    where: { id: doctor.id },
    data: { bookingMode: parsed.data.bookingMode, bookingModeLockedAt: new Date() },
  });

  // In-flight sessions point at steps the new flow does not own; clearing them
  // restarts patients cleanly at the new flow's entry step.
  if (parsed.data.force) {
    await prisma.conversationSession.deleteMany({ where: { doctorId: doctor.id } });
  }

  res.json({ id: updated.id, bookingMode: updated.bookingMode });
});

/** Non-mode config updates (cap, hours, duration, leave). */
const configBody = z.object({
  dailyTokenCap: z.coerce.number().int().min(1).max(500).optional(),
  consultDurationMins: z.coerce.number().int().min(1).max(180).optional(),
  defaultLanguage: z.enum(['EN', 'KN']).optional(),
  whatsappPhoneNumberId: z.string().optional(),
  whatsappNumber: z.string().optional(),
  missedCallNumber: z.string().optional(),
  workingHours: workingHoursSchema.optional(),
  leaveDates: z.array(z.string()).optional(),
}).strict();

adminRouter.patch('/admin/doctor/:id', requireAdminKey, async (req, res) => {
  const parsed = configBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
    return;
  }

  const body = parsed.data;

  let whatsappNumber: string | undefined;
  if (body.whatsappNumber !== undefined) {
    const phone = normalisePhone(body.whatsappNumber);
    if (!phone.ok) {
      res.status(400).json({ error: phoneError(phone.reason) });
      return;
    }
    whatsappNumber = phone.digits;
  }

  const leaveDates = body.leaveDates?.map(parseDateOnly);
  if (leaveDates?.some((d) => d === null)) {
    res.status(400).json({ error: 'leaveDates entries must be YYYY-MM-DD' });
    return;
  }

  // Built once and reported back, so a caller can tell a real write from a
  // request that changed nothing. `updated: true` said the same either way.
  const data = {
    ...(body.dailyTokenCap !== undefined ? { dailyTokenCap: body.dailyTokenCap } : {}),
    ...(body.consultDurationMins !== undefined
      ? { consultDurationMins: body.consultDurationMins }
      : {}),
    ...(body.defaultLanguage ? { defaultLanguage: body.defaultLanguage } : {}),
    ...(body.whatsappPhoneNumberId
      ? { whatsappPhoneNumberId: body.whatsappPhoneNumberId }
      : {}),
    ...(whatsappNumber ? { whatsappNumber } : {}),
    ...(body.missedCallNumber ? { missedCallNumber: body.missedCallNumber } : {}),
    ...(body.workingHours ? { workingHours: body.workingHours as object } : {}),
    ...(leaveDates ? { leaveDates: leaveDates as Date[] } : {}),
  };

  const doctor = await prisma.doctor
    .update({ where: { id: req.params['id'] ?? '' }, data })
    .catch(() => null);

  if (!doctor) {
    res.status(404).json({ error: 'Doctor not found' });
    return;
  }

  // An empty list is the honest answer to "your request changed nothing".
  res.json({ id: doctor.id, updated: Object.keys(data) });
});

/** List all doctors with pagination. */
adminRouter.get('/admin/doctors', requireAdminKey, async (req, res) => {
  // parseInt returns NaN (not null) for a missing ?page, and `NaN ?? 1` keeps
  // the NaN — which propagated into `skip` and broke the query.
  const parsedPage = Number.parseInt(String(req.query['page'] ?? ''), 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const limit = 10;
  const skip = (page - 1) * limit;

  const [doctors, total] = await Promise.all([
    prisma.doctor.findMany({
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.doctor.count(),
  ]);

  const pages = Math.ceil(total / limit);
  res.json({
    data: doctors,
    pagination: {
      page,
      limit,
      total,
      pages,
    },
  });
});

/** Toggle doctor status between ACTIVE and DISABLED. */
const statusToggleBody = z.object({
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
}).strict();

adminRouter.post('/admin/doctor/:id/toggle-status', requireAdminKey, async (req, res) => {
  const parsed = statusToggleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
    return;
  }

  const doctor = await prisma.doctor.findUnique({ where: { id: req.params['id'] ?? '' } });
  if (!doctor) {
    res.status(404).json({ error: 'Doctor not found' });
    return;
  }

  const newStatus = parsed.data.status || (doctor.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE');

  const updated = await prisma.doctor.update({
    where: { id: doctor.id },
    data: { status: newStatus },
    select: {
      id: true,
      name: true,
      status: true,
      updatedAt: true,
    },
  });

  res.json(updated);
});

/** Rotate the API key for a doctor. Returns the new key once. */
adminRouter.post('/admin/doctor/:id/rotate-key', requireAdminKey, async (req, res) => {
  const doctor = await prisma.doctor.findUnique({ where: { id: req.params['id'] ?? '' } });
  if (!doctor) {
    res.status(404).json({ error: 'Doctor not found' });
    return;
  }

  const newApiKey = `dk_${crypto.randomBytes(24).toString('hex')}`;

  const updated = await prisma.doctor.update({
    where: { id: doctor.id },
    data: { apiKey: newApiKey },
    select: {
      id: true,
      name: true,
      apiKey: true,
    },
  });

  res.json({
    id: updated.id,
    name: updated.name,
    apiKey: updated.apiKey,
    message: 'New API key generated. Save it now — it will not be shown again.',
  });
});
