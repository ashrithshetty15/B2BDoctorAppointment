import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Doctor } from '@prisma/client';

const appointmentFindMany = vi.fn();
const appointmentFindFirst = vi.fn();
const appointmentCreate = vi.fn();
const externalBusyFindMany = vi.fn();

vi.mock('../db/prisma', () => ({
  prisma: {
    appointment: {
      findMany: (...a: unknown[]) => appointmentFindMany(...a),
      findFirst: (...a: unknown[]) => appointmentFindFirst(...a),
      create: (...a: unknown[]) => appointmentCreate(...a),
    },
    externalBusy: { findMany: (...a: unknown[]) => externalBusyFindMany(...a) },
  },
}));

import { bookSlot, getAvailableSlots } from './slots';

/**
 * Imported calendar blocks, where they actually bite.
 *
 * slots.test.ts covers only the pure arithmetic, so neither of the two
 * functions that decide whether a patient gets a time had any coverage at all
 * before this. The write path matters most: bookSlot re-derives the slot grid
 * itself, so a check living only in getAvailableSlots would hide a blocked time
 * from the list while still letting a posted form book it.
 */

const MONDAY = new Date('2026-09-21T00:00:00.000Z');

const doctor = {
  id: 'doc-1',
  timezone: 'Asia/Kolkata',
  consultDurationMins: 30,
  leaveDates: [],
  workingHours: { mon: [{ start: '09:00', end: '11:00' }] },
} as unknown as Doctor;

/** 09:00 IST on the Monday = 03:30Z. Slots: 03:30, 04:00, 04:30, 05:00. */
const ist = (hhmm: string) => new Date(`2026-09-21T${hhmm}:00.000Z`);

const before = new Date('2026-09-21T00:00:00.000Z');

beforeEach(() => {
  appointmentFindMany.mockReset().mockResolvedValue([]);
  appointmentFindFirst.mockReset().mockResolvedValue(null);
  appointmentCreate.mockReset().mockImplementation(async ({ data }: { data: object }) => ({
    id: 'new-appt',
    ...data,
  }));
  externalBusyFindMany.mockReset().mockResolvedValue([]);
});

describe('getAvailableSlots against imported busy time', () => {
  it('offers the whole morning when nothing is blocked', async () => {
    const slots = await getAvailableSlots(doctor, MONDAY, before);

    expect(slots.map((s) => s.start.toISOString().slice(11, 16))).toEqual([
      '03:30',
      '04:00',
      '04:30',
      '05:00',
    ]);
  });

  it('drops a slot the doctor s own calendar has taken', async () => {
    externalBusyFindMany.mockResolvedValue([{ startsAt: ist('04:00'), endsAt: ist('04:30') }]);

    const slots = await getAvailableSlots(doctor, MONDAY, before);

    expect(slots.map((s) => s.start.toISOString().slice(11, 16))).toEqual([
      '03:30',
      '04:30',
      '05:00',
    ]);
  });

  /** The block lands mid-slot, which is the normal case — grids rarely align. */
  it('drops a slot a block only partly covers', async () => {
    externalBusyFindMany.mockResolvedValue([{ startsAt: ist('04:15'), endsAt: ist('04:20') }]);

    const slots = await getAvailableSlots(doctor, MONDAY, before);

    expect(slots.map((s) => s.start.toISOString().slice(11, 16))).not.toContain('04:00');
    expect(slots).toHaveLength(3);
  });

  it('keeps a slot a block merely runs up to', async () => {
    externalBusyFindMany.mockResolvedValue([{ startsAt: ist('03:00'), endsAt: ist('04:00') }]);

    const slots = await getAvailableSlots(doctor, MONDAY, before);

    expect(slots.map((s) => s.start.toISOString().slice(11, 16))).toContain('04:00');
  });

  it('empties the day when a block covers all of it', async () => {
    externalBusyFindMany.mockResolvedValue([{ startsAt: ist('00:00'), endsAt: ist('23:59') }]);

    expect(await getAvailableSlots(doctor, MONDAY, before)).toEqual([]);
  });
});

describe('bookSlot against imported busy time', () => {
  it('books when the time is free', async () => {
    const result = await bookSlot(doctor, 'pat-1', MONDAY, ist('04:00'), before);

    expect(result.ok).toBe(true);
    expect(appointmentCreate).toHaveBeenCalled();
  });

  /**
   * The one that matters. Hiding a time from the list is not the same as
   * refusing to book it — the desk's form and a crafted request both post a
   * time straight in.
   */
  it('refuses a blocked time even though the grid still produces it', async () => {
    externalBusyFindMany.mockResolvedValue([{ startsAt: ist('04:10'), endsAt: ist('04:20') }]);

    const result = await bookSlot(doctor, 'pat-1', MONDAY, ist('04:00'), before);

    expect(result).toEqual({ ok: false, reason: 'BLOCKED' });
    expect(appointmentCreate).not.toHaveBeenCalled();
  });

  it('is a different answer from the slot being taken by a patient', async () => {
    externalBusyFindMany.mockResolvedValue([{ startsAt: ist('04:00'), endsAt: ist('04:30') }]);

    const result = await bookSlot(doctor, 'pat-1', MONDAY, ist('04:00'), before);

    // TAKEN would tell the desk to try another time; BLOCKED tells them their
    // own calendar is the reason, which is something they can go and change.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).not.toBe('TAKEN');
  });

  it('still books a neighbouring time', async () => {
    externalBusyFindMany.mockResolvedValue([{ startsAt: ist('04:00'), endsAt: ist('04:30') }]);

    const result = await bookSlot(doctor, 'pat-1', MONDAY, ist('04:30'), before);

    expect(result.ok).toBe(true);
  });
});
