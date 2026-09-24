import { DateTime } from 'luxon';
import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';

/**
 * Busy time imported from the doctor's own calendar.
 *
 * A clinic that also books through Practo, or keeps a personal Google Calendar,
 * has its day recorded in two places, and nothing stopped us offering a slot
 * that was already gone. Practo Ray hands every doctor a read-only iCal feed
 * URL for pasting into Google Calendar; so does Google, and so does Outlook.
 * Accepting that URL is one integration that covers all of them, and needs no
 * partnership with any of them.
 *
 * TWO RULES THIS MODULE KEEPS
 *
 * Intervals only. The feed may carry event titles naming other patients, and
 * importing those would pull another clinic system's patient data into this one
 * for no benefit. A start and an end is all availability needs.
 *
 * Nothing here is ever called while a patient waits. The sweep fetches feeds in
 * the background and writes rows; availability reads those rows. An inline fetch
 * would sit inside getNextAvailableDates' 21-day loop on the WhatsApp booking
 * path, and a slow calendar provider would make the clinic unbookable.
 */

export interface BusyInterval {
  startsAt: Date;
  endsAt: Date;
  /** The event's id in the source calendar. Opaque — for diffing, never shown. */
  uid?: string;
}

/** How far ahead we keep imported blocks. Past that, availability is guesswork anyway. */
export const BUSY_WINDOW_DAYS = 60;

/** A feed that will not answer promptly is a failed sync, not a slow booking. */
const FETCH_TIMEOUT_MS = 10_000;

/** Feeds are text. Anything of this size is a misconfigured URL, not a calendar. */
const MAX_FEED_BYTES = 4_000_000;

// ---------------------------------------------------------------- pure logic

/**
 * Do a slot and a busy block overlap?
 *
 * Half-open on both sides: a block ending exactly when a slot starts does not
 * block it, which is what makes back-to-back appointments work. Overlap rather
 * than equality is the whole point — slot boundaries come from the doctor's
 * consult-duration grid, and an external event almost never lands on it.
 */
export function intervalsOverlap(
  a: { start: Date; end: Date },
  b: { startsAt: Date; endsAt: Date },
): boolean {
  return a.start.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.end.getTime();
}

/** True when any imported block covers any part of this slot. */
export function isBlocked(slot: { start: Date; end: Date }, blocks: BusyInterval[]): boolean {
  return blocks.some((b) => intervalsOverlap(slot, b));
}

/**
 * Turn an iCal document into intervals, within a window.
 *
 * All-day events are rebuilt in the *clinic's* timezone rather than trusted as
 * parsed. `DTSTART;VALUE=DATE:20260926` carries no time, and the parser resolves
 * it against whatever zone the process happens to run in — midnight IST on a
 * laptop in Bengaluru, midnight UTC on the server. A doctor blocking a
 * conference day means their own day, so it is rebuilt from the calendar date.
 */
export function parseBusyFeed(
  ics: string,
  opts: { from: Date; to: Date; timezone: string },
): BusyInterval[] {
  // Required lazily: node-ical pulls in a timezone database, and nothing on the
  // request path should pay for that at boot.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ical = require('node-ical') as typeof import('node-ical');

  const parsed = ical.parseICS(ics);
  const out: BusyInterval[] = [];

  for (const value of Object.values(parsed)) {
    const event = value as {
      type?: string;
      start?: Date;
      end?: Date;
      datetype?: string;
      uid?: string;
      status?: string;
      transparency?: string;
      rrule?: { between: (a: Date, b: Date, inc?: boolean) => Date[] };
    };

    if (event.type !== 'VEVENT' || !event.start || !event.end) continue;

    // A cancelled event is not busy time, and neither is one the calendar owner
    // marked "free" (Google's "Show as: Free").
    if (event.status === 'CANCELLED') continue;
    if (event.transparency === 'TRANSPARENT') continue;

    const allDay = event.datetype === 'date';
    const durationMs = Math.max(0, event.end.getTime() - event.start.getTime());

    const starts: Date[] = event.rrule
      ? event.rrule.between(opts.from, opts.to, true)
      : [event.start];

    for (const start of starts) {
      const interval = allDay
        ? allDayInterval(start, durationMs, opts.timezone)
        : { startsAt: start, endsAt: new Date(start.getTime() + durationMs) };

      // Zero-length events block nothing; a malformed one must not block a day.
      if (interval.endsAt.getTime() <= interval.startsAt.getTime()) continue;
      if (interval.endsAt <= opts.from || interval.startsAt >= opts.to) continue;

      out.push({ ...interval, ...(event.uid ? { uid: event.uid } : {}) });
    }
  }

  return out;
}

/**
 * Rebuild an all-day event against the clinic's clock.
 *
 * The parser resolved the bare date in the process's own zone, so read the
 * calendar date back the same way and re-anchor it where the doctor actually
 * works.
 */
function allDayInterval(
  start: Date,
  durationMs: number,
  timezone: string,
): { startsAt: Date; endsAt: Date } {
  const days = Math.max(1, Math.round(durationMs / 86_400_000));
  const calendarDate = DateTime.fromJSDate(start).toFormat('yyyy-MM-dd');
  const local = DateTime.fromISO(calendarDate, { zone: timezone }).startOf('day');

  return {
    startsAt: local.toJSDate(),
    endsAt: local.plus({ days }).toJSDate(),
  };
}

// ---------------------------------------------------------------------- I/O

/**
 * Fetch a feed. Bounded in time and size, because this URL is pasted in by hand
 * and may point at anything at all.
 */
export async function fetchBusyFeed(url: string): Promise<string> {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: 'text/calendar, text/plain;q=0.9, */*;q=0.1' },
  });

  if (!response.ok) throw new Error(`feed returned ${response.status}`);

  const body = await response.text();
  if (body.length > MAX_FEED_BYTES) throw new Error('feed is too large to be a calendar');
  // A URL that 200s with a login page is the commonest mistake; say so plainly
  // rather than reporting "0 events".
  if (!body.includes('BEGIN:VCALENDAR')) throw new Error('that URL did not return a calendar');

  return body;
}

/**
 * Refresh one doctor's blocks from their feed.
 *
 * Replace rather than merge: the feed is the truth, and an event deleted there
 * must stop blocking here. Scoped to the forward window so a replace never
 * touches history.
 *
 * Never throws. A calendar provider being down is not a reason for the sweep to
 * stop, and the previous blocks stay in place until a fetch succeeds — stale
 * busy time is safer than a day that suddenly looks free.
 */
export async function syncBusyFeed(doctor: {
  id: string;
  busyFeedUrl: string | null;
  timezone: string;
}): Promise<{ ok: boolean; imported?: number; error?: string }> {
  if (!doctor.busyFeedUrl) return { ok: true, imported: 0 };

  const from = new Date();
  const to = new Date(from.getTime() + BUSY_WINDOW_DAYS * 86_400_000);

  try {
    const ics = await fetchBusyFeed(doctor.busyFeedUrl);
    const intervals = parseBusyFeed(ics, { from, to, timezone: doctor.timezone });

    await prisma.$transaction([
      prisma.externalBusy.deleteMany({
        where: { doctorId: doctor.id, source: 'ICAL', endsAt: { gte: from } },
      }),
      prisma.externalBusy.createMany({
        data: intervals.map((i) => ({
          doctorId: doctor.id,
          startsAt: i.startsAt,
          endsAt: i.endsAt,
          source: 'ICAL',
          externalUid: i.uid ?? null,
        })),
      }),
      prisma.doctor.update({
        where: { id: doctor.id },
        data: { busyFeedSyncedAt: new Date(), busyFeedError: null },
      }),
    ]);

    return { ok: true, imported: intervals.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'could not read that calendar';
    // The URL is the credential for these feeds, so it never reaches the log.
    logger.warn({ doctorId: doctor.id, err: message }, 'Calendar feed sync failed');

    await prisma.doctor
      .update({ where: { id: doctor.id }, data: { busyFeedError: message } })
      .catch(() => undefined);

    return { ok: false, error: message };
  }
}

/** Every doctor with a feed configured. */
export async function doctorsWithBusyFeed() {
  return prisma.doctor.findMany({
    where: { busyFeedUrl: { not: null }, status: 'ACTIVE' },
    select: { id: true, busyFeedUrl: true, timezone: true },
  });
}

/** Imported blocks touching a window. The only read on the availability path. */
export async function busyForDoctor(
  doctorId: string,
  from: Date,
  to: Date,
): Promise<BusyInterval[]> {
  const rows = await prisma.externalBusy.findMany({
    where: { doctorId, startsAt: { lt: to }, endsAt: { gt: from } },
    select: { startsAt: true, endsAt: true },
    orderBy: { startsAt: 'asc' },
  });

  return rows;
}

/**
 * Appointments that an imported block now sits on top of.
 *
 * Surfaced for a human, never acted on. An outside calendar must not be able to
 * cancel or move a commitment this clinic made to a patient — the slot simply
 * stops being offered to anyone new, and the desk decides what to do about the
 * one already booked.
 */
export async function clashingAppointments(doctorId: string, from: Date) {
  const to = new Date(from.getTime() + BUSY_WINDOW_DAYS * 86_400_000);

  const [blocks, booked] = await Promise.all([
    busyForDoctor(doctorId, from, to),
    prisma.appointment.findMany({
      where: {
        doctorId,
        type: 'SLOT',
        status: { in: ['BOOKED', 'ARRIVED'] },
        slotStart: { gte: from, lt: to },
      },
      select: {
        id: true,
        slotStart: true,
        slotEnd: true,
        patient: { select: { name: true, phone: true } },
      },
      orderBy: { slotStart: 'asc' },
    }),
  ]);

  if (blocks.length === 0) return [];

  return booked.filter(
    (a) =>
      a.slotStart &&
      a.slotEnd &&
      isBlocked({ start: a.slotStart, end: a.slotEnd }, blocks),
  );
}
