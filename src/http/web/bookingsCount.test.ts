import type { Doctor } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { bookingsPage, type QueueRow } from './doctorViews';

/**
 * What "Booked" counts on the day view.
 *
 * Reported by the clinic: a day showing two bookings and one cancellation read
 * as "3 Booked". The tile counted every row it was handed, and cancelled
 * appointments are deliberately still listed — struck through — because the
 * desk wants the history. History is not a booking.
 *
 * The number matters more than it looks: it is the first thing on the screen,
 * and it is what a doctor uses to decide whether the afternoon is full.
 */

const doctor = {
  id: 'doc-1',
  name: 'Kiran Shetty',
  defaultLanguage: 'EN',
  timezone: 'Asia/Kolkata',
  bookingMode: 'SLOT',
  specialty: 'Orthodontist',
} as unknown as Doctor;

const row = (status: string, time: string, name: string): QueueRow => ({
  appointmentId: `a-${time}`,
  status,
  type: 'SLOT',
  tokenNumber: null,
  slotStart: new Date(`2026-09-28T${time}:00.000Z`),
  patient: { id: `p-${name}`, name, phone: '919000000001' },
  bookedAt: new Date('2026-09-27T10:00:00.000Z'),
  arrivedAt: null,
  startedAt: null,
  completedAt: null,
  consultMins: null,
  notes: null,
  source: 'WHATSAPP',
});

const render = (rows: QueueRow[]) =>
  bookingsPage({
    bookingNumber: '919731028452',
    doctor,
    rows: rows as never,
    queue: { nowServing: 0 } as never,
    date: '2026-09-28',
    prevDate: '2026-09-27',
    nextDate: '2026-09-29',
    isToday: false,
    isPast: false,
    dateLabel: 'Mon, 28 Sep',
    queueCount: 0,
    csrfToken: 't',
  });

/** The three stat tiles, in the order they are rendered. */
const tiles = (html: string): string[] =>
  [...html.matchAll(/<div class="n">(\d+)<\/div>/g)].map((m) => m[1]!);

describe('the Booked tile', () => {
  /** The exact day from the report: 09:20 booked, 09:40 booked, 10:00 cancelled. */
  it('does not count a cancelled appointment as booked', () => {
    const html = render([
      row('BOOKED', '09:20', 'Ashrith Shetty'),
      row('BOOKED', '09:40', 'Ektha'),
      row('CANCELLED', '10:00', 'Ektha'),
    ]);

    expect(tiles(html)[0]).toBe('2');
  });

  /**
   * No-shows stay in the count on purpose: they were booked, and the day breaks
   * them out separately, so "3 booked, 2 seen, 1 no-show" reconciles.
   */
  it('still counts a no-show, which is broken out separately', () => {
    const html = render([
      row('DONE', '09:20', 'Ashrith Shetty'),
      row('DONE', '09:40', 'Ektha'),
      row('NO_SHOW', '10:00', 'Soum Prad'),
    ]);

    const [booked, seen, noShow] = tiles(html);
    expect(booked).toBe('3');
    expect(seen).toBe('2');
    expect(noShow).toBe('1');
  });

  it('counts a day where everything was cancelled as none booked', () => {
    const html = render([
      row('CANCELLED', '09:20', 'Ashrith Shetty'),
      row('CANCELLED', '09:40', 'Ektha'),
    ]);

    expect(tiles(html)[0]).toBe('0');
  });

  /**
   * Cancelled rows are still shown — the desk needs to see what happened, and
   * "not counted" must not quietly become "not displayed".
   *
   * Asserted on the patient rather than the time: the view renders slotStart in
   * the doctor's timezone, so a UTC fixture time never appears verbatim.
   */
  it('still lists the cancelled appointment even though it is not counted', () => {
    const html = render([
      row('BOOKED', '09:40', 'Ektha'),
      row('CANCELLED', '10:00', 'Soum Prad'),
    ]);

    expect(tiles(html)[0]).toBe('1');
    expect(html).toContain('Soum Prad');
  });
});
