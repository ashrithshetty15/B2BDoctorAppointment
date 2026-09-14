import { describe, expect, it } from 'vitest';
import type { DayKey, WorkingHours } from './slots';
import {
  type ConflictCandidate,
  buildWorkingHours,
  findHoursConflicts,
  parseDayWindows,
  workingHoursToText,
} from './workingHours';

const LABELS: Record<DayKey, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

const blank = (): Record<DayKey, string> => ({
  mon: '',
  tue: '',
  wed: '',
  thu: '',
  fri: '',
  sat: '',
  sun: '',
});

describe('parseDayWindows', () => {
  it('parses a single session and a split day', () => {
    expect(parseDayWindows('Monday', '09:30-13:00')).toEqual([{ start: '09:30', end: '13:00' }]);
    expect(parseDayWindows('Monday', '09:30-13:00, 17:00-20:00')).toEqual([
      { start: '09:30', end: '13:00' },
      { start: '17:00', end: '20:00' },
    ]);
  });

  it('treats a blank day as closed rather than an error', () => {
    expect(parseDayWindows('Sunday', '')).toEqual([]);
    expect(parseDayWindows('Sunday', '   ')).toEqual([]);
  });

  it('sorts windows so the stored order does not depend on typing order', () => {
    expect(parseDayWindows('Monday', '17:00-20:00, 09:30-13:00')).toEqual([
      { start: '09:30', end: '13:00' },
      { start: '17:00', end: '20:00' },
    ]);
  });

  /**
   * The admin JSON API's Zod schema only checked \d{1,2}:\d{2}, so it accepted
   * these. Everything writes through this parser now.
   */
  it('rejects times that are not on a real 24-hour clock', () => {
    expect(() => parseDayWindows('Monday', '77:99-88:00')).toThrow(/24-hour/);
    expect(() => parseDayWindows('Monday', '25:00-26:00')).toThrow(/24-hour/);
    expect(() => parseDayWindows('Monday', '09:60-10:00')).toThrow(/24-hour/);
  });

  it('rejects a window that ends before it starts', () => {
    expect(() => parseDayWindows('Monday', '17:00-09:00')).toThrow(/ends before it starts/);
    // Zero-length is equally useless and would generate no slots.
    expect(() => parseDayWindows('Monday', '09:00-09:00')).toThrow(/ends before it starts/);
  });

  it('rejects overlapping windows', () => {
    expect(() => parseDayWindows('Monday', '09:00-13:00, 12:00-17:00')).toThrow(/overlaps/);
  });

  it('allows windows that merely touch', () => {
    expect(() => parseDayWindows('Monday', '09:00-13:00, 13:00-17:00')).not.toThrow();
  });

  it('rejects malformed shapes', () => {
    expect(() => parseDayWindows('Monday', '09:30')).toThrow(/09:30-13:00/);
    expect(() => parseDayWindows('Monday', '09:30-13:00-17:00')).toThrow(/09:30-13:00/);
    expect(() => parseDayWindows('Monday', 'nine to five')).toThrow();
  });

  it('names the day in the error, since the form shows one field per day', () => {
    expect(() => parseDayWindows('Thursday', 'rubbish')).toThrow(/^Thursday:/);
  });
});

describe('buildWorkingHours', () => {
  it('omits closed days entirely rather than storing an empty array', () => {
    const hours = buildWorkingHours({ ...blank(), mon: '09:00-13:00' }, LABELS);
    expect(hours).toEqual({ mon: [{ start: '09:00', end: '13:00' }] });
    expect('sun' in hours).toBe(false);
  });

  it('round-trips through the text form', () => {
    const text = { ...blank(), mon: '09:30-13:00, 17:00-20:00', sat: '09:30-13:00' };
    expect(workingHoursToText(buildWorkingHours(text, LABELS))).toEqual(text);
  });
});

describe('findHoursConflicts', () => {
  const TZ = 'Asia/Kolkata';
  // 2026-09-14 is a Monday. @db.Date values are UTC midnight.
  const monday = new Date(Date.UTC(2026, 8, 14));

  const slotAt = (hhmm: string, id = 'a1'): ConflictCandidate => ({
    id,
    date: monday,
    type: 'SLOT',
    // 10:30 IST is 05:00Z — the conversion is the point of the test.
    slotStart: new Date(`2026-09-14T${hhmm}:00+05:30`),
    tokenNumber: null,
    patient: { name: 'Prakash', phone: '919876543210' },
  });

  const token: ConflictCandidate = {
    id: 't1',
    date: monday,
    type: 'TOKEN',
    slotStart: null,
    tokenNumber: 4,
    patient: { name: 'Fatima', phone: '919845012345' },
  };

  const open: WorkingHours = { mon: [{ start: '09:30', end: '13:00' }] };

  it('passes a slot inside the window', () => {
    expect(findHoursConflicts([slotAt('10:30')], open, TZ)).toEqual([]);
  });

  it('flags a slot that the new hours no longer cover', () => {
    const out = findHoursConflicts([slotAt('17:30')], open, TZ);
    expect(out).toHaveLength(1);
    expect(out[0]?.reason).toBe('OUTSIDE');
  });

  it('treats the window end as exclusive, matching slot generation', () => {
    // A 13:00 slot in a 09:30-13:00 day would have no room to run, and
    // generateSlots never emits one.
    expect(findHoursConflicts([slotAt('13:00')], open, TZ)).toHaveLength(1);
    expect(findHoursConflicts([slotAt('09:30')], open, TZ)).toEqual([]);
  });

  it('flags everything on a weekday that is being closed, tokens included', () => {
    const out = findHoursConflicts([slotAt('10:30'), token], {}, TZ);
    expect(out).toHaveLength(2);
    expect(out.every((cl) => cl.reason === 'DAY_CLOSED')).toBe(true);
  });

  /** A token has no time of its own, so an open day is all it needs. */
  it('does not flag a token while its weekday stays open', () => {
    expect(findHoursConflicts([token], open, TZ)).toEqual([]);
  });

  it('judges the slot in the clinic timezone, not UTC', () => {
    // 09:00 IST is 03:30Z the same day; read as UTC it would look like 03:30 and
    // be wrongly flagged as outside a 09:30-13:00 day.
    const out = findHoursConflicts([slotAt('09:00')], open, TZ);
    expect(out).toHaveLength(1);
    expect(out[0]?.reason).toBe('OUTSIDE');
    // ...and 09:45 IST is inside, though 09:45Z would not be.
    expect(findHoursConflicts([slotAt('09:45')], open, TZ)).toEqual([]);
  });

  it('checks each appointment against its own weekday', () => {
    const tuesday = new Date(Date.UTC(2026, 8, 15));
    const onTuesday: ConflictCandidate = {
      ...slotAt('10:30', 'a2'),
      date: tuesday,
      slotStart: new Date('2026-09-15T10:30:00+05:30'),
    };
    // Monday is open, Tuesday is not.
    const out = findHoursConflicts([slotAt('10:30'), onTuesday], open, TZ);
    expect(out.map((cl) => cl.id)).toEqual(['a2']);
  });

  it('returns nothing for an empty list', () => {
    expect(findHoursConflicts([], {}, TZ)).toEqual([]);
  });
});
