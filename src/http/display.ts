import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { getOrCreateQueueState } from '../domain/tokenQueue';
import { slotLabel } from '../domain/slots';
import { clinicToday } from '../utils/time';
import { DateTime } from 'luxon';
import { boardMain, boardPage, type BoardData } from './web/displayView';

/**
 * The waiting-room board, served to a screen with nobody signed in to it.
 *
 * Public by necessity and read-only by design. Mounted ahead of the console
 * routers so it sits outside every session and CSRF check — the same reasoning
 * as /privacy: whatever opens this URL is a television.
 *
 * The key in the path is NOT the doctor's console key. This address gets pinned
 * to a wall and read off the screen by anyone standing near it; if it were the
 * console key, a glance at the address bar would be full access to every
 * patient record.
 */
export const displayRouter = Router();

/** How many upcoming entries to show beside the current one. */
const NEXT_SHOWN = 4;

displayRouter.get('/display/:key', async (req, res) => {
  const key = String(req.params['key'] ?? '');
  // Length-checked before the query so a probe for short keys never reaches the
  // database, and an empty segment can never match a NULL column.
  if (key.length < 16) {
    res.status(404).type('text').send('Not found');
    return;
  }

  const doctor = await prisma.doctor.findUnique({
    where: { displayKey: key },
    include: { clinic: true },
  });

  if (!doctor || doctor.status !== 'ACTIVE') {
    res.status(404).type('text').send('Not found');
    return;
  }

  const data = await boardData(doctor);

  // Never cached: a board showing a token from ten minutes ago is worse than a
  // board showing nothing, and proxies between a clinic TV and here are common.
  res.set('Cache-Control', 'no-store');

  if (req.query['fragment']) {
    res.json({ main: boardMain(data).__html, clock: data.updatedAt });
    return;
  }

  res.type('html').send(boardPage(data));
});

/** The doctor plus the clinic that owns the number and the display name. */
type DoctorWithClinic = Prisma.DoctorGetPayload<{ include: { clinic: true } }>;

async function boardData(doctor: DoctorWithClinic): Promise<BoardData> {
  const today = clinicToday(doctor.timezone);
  const now = DateTime.now().setZone(doctor.timezone);

  const base = {
    clinicName: doctor.clinic?.name ?? doctor.clinicName,
    doctorName: doctor.name,
    specialty: doctor.specialty,
    whatsappNumber: doctor.clinic?.whatsappNumber ?? doctor.whatsappNumber,
    updatedAt: now.toFormat('hh:mm a'),
  };

  if (doctor.bookingMode === 'SLOT') return { ...base, ...(await slotBoard(doctor, today, now)) };
  return { ...base, ...(await tokenBoard(doctor, today)) };
}

/** Token queues: the number in the room, then the numbers after it. */
async function tokenBoard(doctor: DoctorWithClinic, today: Date) {
  const [state, active] = await Promise.all([
    getOrCreateQueueState(doctor.id, today),
    prisma.appointment.findMany({
      where: {
        doctorId: doctor.id,
        date: today,
        type: 'TOKEN',
        status: { in: ['BOOKED', 'ARRIVED'] },
      },
      orderBy: { tokenNumber: 'asc' },
      // Only the number is read. Selecting the patient relation here is how a
      // name ends up on a wall by accident later.
      select: { tokenNumber: true },
    }),
  ]);

  const serving = state.nowServingToken;
  const next = active
    .map((a) => a.tokenNumber)
    .filter((n): n is number => n !== null && (serving === null || n > serving))
    .slice(0, NEXT_SHOWN)
    .map(String);

  return {
    mode: 'TOKEN' as const,
    nowServing: serving === null ? null : String(serving),
    next,
    waiting: active.length,
    delayMins: state.delayMins,
    isClosed: state.isClosed,
  };
}

/**
 * Slot clinics have no "now serving" of their own, so the board reads the
 * appointment currently in progress, or failing that the one most recently due.
 * Without this a three-doctor slot clinic would hang a blank screen on the wall.
 */
async function slotBoard(
  doctor: DoctorWithClinic,
  today: Date,
  now: DateTime,
) {
  const appointments = await prisma.appointment.findMany({
    where: {
      doctorId: doctor.id,
      date: today,
      type: 'SLOT',
      status: { in: ['BOOKED', 'ARRIVED', 'IN_PROGRESS'] },
      slotStart: { not: null },
    },
    orderBy: { slotStart: 'asc' },
    select: { slotStart: true, status: true },
  });

  const label = (at: Date) => slotLabel({ start: at, end: at }, doctor.timezone);
  const inRoom = appointments.find((a) => a.status === 'IN_PROGRESS');
  const started = appointments.filter((a) => a.slotStart! <= now.toJSDate());
  const current = inRoom ?? started.at(-1) ?? null;

  const upcoming = appointments
    .filter((a) => a.slotStart! > now.toJSDate())
    .slice(0, NEXT_SHOWN)
    .map((a) => label(a.slotStart!));

  const state = await getOrCreateQueueState(doctor.id, today);

  return {
    mode: 'SLOT' as const,
    nowServing: current?.slotStart ? label(current.slotStart) : null,
    next: upcoming,
    waiting: appointments.filter((a) => a.status !== 'IN_PROGRESS').length,
    delayMins: state.delayMins,
    isClosed: state.isClosed,
  };
}
