import { describe, expect, it } from 'vitest';
import { availablePeriods, periodOf, splitByPeriod } from './dayPeriods';

const IST = 'Asia/Kolkata';

/** IST is UTC+5:30, so an IST wall-clock time is 5h30m earlier in UTC. */
const ist = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 8, 18, h! - 5, m! - 30));
};

describe('periodOf', () => {
  it.each([
    ['00:05', 'MORNING'],
    ['09:00', 'MORNING'],
    ['11:59', 'MORNING'],
    ['12:00', 'AFTERNOON'],
    ['16:59', 'AFTERNOON'],
    ['17:00', 'EVENING'],
    ['20:30', 'EVENING'],
    ['23:59', 'EVENING'],
  ])('puts %s in the %s', (time, expected) => {
    expect(periodOf(ist(time), IST)).toBe(expected);
  });

  /**
   * The boundary that matters: a slot is classified by the clinic's wall clock,
   * not the server's. 17:30 IST is 12:00 UTC — an evening appointment either
   * way, but only if the timezone is honoured.
   */
  it('classifies by the clinic clock, not the server clock', () => {
    const eveningInIndia = ist('17:30');
    expect(periodOf(eveningInIndia, IST)).toBe('EVENING');
    expect(periodOf(eveningInIndia, 'UTC')).toBe('AFTERNOON');
  });
});

describe('splitByPeriod', () => {
  const slots = ['09:00', '11:40', '12:00', '15:00', '18:00', '19:30'].map((t) => ({
    start: ist(t),
  }));

  it('groups a day into its three parts, keeping order', () => {
    const out = splitByPeriod(slots, IST, (s) => s.start);
    expect(out.MORNING).toHaveLength(2);
    expect(out.AFTERNOON).toHaveLength(2);
    expect(out.EVENING).toHaveLength(2);
    expect(out.EVENING[0]?.start).toEqual(ist('18:00'));
  });

  /** Empty buckets are kept: "no evening slots" must be distinguishable. */
  it('returns all three keys even when a part of the day is empty', () => {
    const out = splitByPeriod([{ start: ist('09:00') }], IST, (s) => s.start);
    expect(Object.keys(out)).toEqual(['MORNING', 'AFTERNOON', 'EVENING']);
    expect(out.EVENING).toEqual([]);
  });

  it('handles a day with nothing free', () => {
    const out = splitByPeriod([], IST, (s: { start: Date }) => s.start);
    expect(out).toEqual({ MORNING: [], AFTERNOON: [], EVENING: [] });
  });
});

describe('availablePeriods', () => {
  it('lists only the parts with something free, in order', () => {
    const slots = ['19:00', '09:00'].map((t) => ({ start: ist(t) }));
    expect(availablePeriods(slots, IST, (s) => s.start)).toEqual(['MORNING', 'EVENING']);
  });

  /** One period means the flow should not ask the question at all. */
  it('returns a single entry when the day has one session', () => {
    const slots = ['09:00', '10:00', '11:00'].map((t) => ({ start: ist(t) }));
    expect(availablePeriods(slots, IST, (s) => s.start)).toEqual(['MORNING']);
  });

  it('returns nothing for an empty day', () => {
    expect(availablePeriods([], IST, (s: { start: Date }) => s.start)).toEqual([]);
  });
});
