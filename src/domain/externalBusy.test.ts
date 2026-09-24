import { describe, expect, it } from 'vitest';
import { intervalsOverlap, isBlocked, parseBusyFeed } from './externalBusy';

/**
 * The arithmetic that decides whether a patient is offered a time their doctor
 * is not actually free for.
 *
 * Slot boundaries come from the doctor's consult-duration grid; an imported
 * event lands wherever the other system put it. So the two almost never line
 * up, and equality — which is how a *booked* slot is matched — would let a
 * 10:05 block sit invisibly inside a 10:00 slot.
 */

const at = (hhmm: string) => new Date(`2026-09-24T${hhmm}:00.000Z`);
const slot = (from: string, to: string) => ({ start: at(from), end: at(to) });
const busy = (from: string, to: string) => ({ startsAt: at(from), endsAt: at(to) });

describe('does a block cover a slot', () => {
  const tenToTenThirty = slot('10:00', '10:30');

  it('blocks an exact match', () => {
    expect(intervalsOverlap(tenToTenThirty, busy('10:00', '10:30'))).toBe(true);
  });

  it('blocks when it clips the first minute', () => {
    expect(intervalsOverlap(tenToTenThirty, busy('09:30', '10:01'))).toBe(true);
  });

  it('blocks when it clips the last minute', () => {
    expect(intervalsOverlap(tenToTenThirty, busy('10:29', '11:00'))).toBe(true);
  });

  it('blocks when it sits entirely inside', () => {
    expect(intervalsOverlap(tenToTenThirty, busy('10:10', '10:20'))).toBe(true);
  });

  it('blocks when it swallows the slot whole', () => {
    expect(intervalsOverlap(tenToTenThirty, busy('08:00', '18:00'))).toBe(true);
  });

  /**
   * Half-open at both ends. Without this, a 9:30-10:00 meeting would block the
   * 10:00 appointment, and back-to-back consulting would be impossible.
   */
  it('does NOT block when it ends exactly as the slot starts', () => {
    expect(intervalsOverlap(tenToTenThirty, busy('09:00', '10:00'))).toBe(false);
  });

  it('does NOT block when it starts exactly as the slot ends', () => {
    expect(intervalsOverlap(tenToTenThirty, busy('10:30', '11:00'))).toBe(false);
  });

  it('does NOT block a slot it never reaches', () => {
    expect(intervalsOverlap(tenToTenThirty, busy('14:00', '15:00'))).toBe(false);
  });
});

describe('isBlocked across several blocks', () => {
  const blocks = [busy('09:00', '09:30'), busy('11:00', '12:00')];

  it('is free between two blocks', () => {
    expect(isBlocked(slot('10:00', '10:30'), blocks)).toBe(false);
  });

  it('is blocked by whichever one overlaps', () => {
    expect(isBlocked(slot('11:30', '12:00'), blocks)).toBe(true);
  });

  it('is free when nothing is imported at all', () => {
    expect(isBlocked(slot('10:00', '10:30'), [])).toBe(false);
  });
});

// ---------------------------------------------------------------- parsing

const WINDOW = {
  from: new Date('2026-09-20T00:00:00Z'),
  to: new Date('2026-11-20T00:00:00Z'),
  timezone: 'Asia/Kolkata',
};

function calendar(...events: string[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//test//EN',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');
}

const event = (lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');

describe('reading a calendar feed', () => {
  it('reads a plain timed event', () => {
    const out = parseBusyFeed(
      calendar(
        event(['UID:a@x', 'DTSTART:20260924T100000Z', 'DTEND:20260924T103000Z', 'SUMMARY:Ravi Kumar']),
      ),
      WINDOW,
    );

    expect(out).toHaveLength(1);
    expect(out[0]!.startsAt.toISOString()).toBe('2026-09-24T10:00:00.000Z');
    expect(out[0]!.endsAt.toISOString()).toBe('2026-09-24T10:30:00.000Z');
  });

  /** Nothing from the feed's content is kept — only when, never who. */
  it('keeps no trace of who the event was about', () => {
    const out = parseBusyFeed(
      calendar(
        event([
          'UID:a@x',
          'DTSTART:20260924T100000Z',
          'DTEND:20260924T103000Z',
          'SUMMARY:Ravi Kumar - diabetes review',
          'DESCRIPTION:Patient 9876543210',
        ]),
      ),
      WINDOW,
    );

    expect(JSON.stringify(out)).not.toContain('Ravi');
    expect(JSON.stringify(out)).not.toContain('9876543210');
    expect(JSON.stringify(out)).not.toContain('diabetes');
  });

  /**
   * The case a hand-rolled parser silently drops, and the reason this takes a
   * dependency: a weekly blocked lunch is one VEVENT and many busy hours.
   */
  it('expands a recurring event into every occurrence', () => {
    const out = parseBusyFeed(
      calendar(
        event([
          'UID:r@x',
          'DTSTART:20260921T060000Z',
          'DTEND:20260921T070000Z',
          'RRULE:FREQ=WEEKLY;COUNT=4',
          'SUMMARY:Lunch',
        ]),
      ),
      WINDOW,
    );

    expect(out).toHaveLength(4);
    expect(out.map((b) => b.startsAt.toISOString().slice(0, 10))).toEqual([
      '2026-09-21',
      '2026-09-28',
      '2026-10-05',
      '2026-10-12',
    ]);
    // Each occurrence keeps the original's length.
    for (const b of out) {
      expect(b.endsAt.getTime() - b.startsAt.getTime()).toBe(60 * 60_000);
    }
  });

  /**
   * An all-day event carries no time, so the parser resolves it against
   * whatever zone the process runs in — midnight IST on a laptop here, midnight
   * UTC on the server. A doctor blocking a conference day means *their* day.
   */
  it('anchors an all-day event to the clinic timezone, not the server', () => {
    const out = parseBusyFeed(
      calendar(event(['UID:d@x', 'DTSTART;VALUE=DATE:20260926', 'DTEND;VALUE=DATE:20260927'])),
      WINDOW,
    );

    expect(out).toHaveLength(1);
    // Midnight to midnight in Asia/Kolkata is 18:30Z the day before.
    expect(out[0]!.startsAt.toISOString()).toBe('2026-09-25T18:30:00.000Z');
    expect(out[0]!.endsAt.toISOString()).toBe('2026-09-26T18:30:00.000Z');
  });

  it('gives the same answer whichever timezone the clinic is in', () => {
    const ics = calendar(
      event(['UID:d@x', 'DTSTART;VALUE=DATE:20260926', 'DTEND;VALUE=DATE:20260927']),
    );

    const kolkata = parseBusyFeed(ics, WINDOW);
    const london = parseBusyFeed(ics, { ...WINDOW, timezone: 'Europe/London' });

    // Same calendar day, different instants — which is the point.
    expect(kolkata[0]!.startsAt.toISOString()).toBe('2026-09-25T18:30:00.000Z');
    expect(london[0]!.startsAt.toISOString()).toBe('2026-09-25T23:00:00.000Z');
  });

  it('ignores a cancelled event', () => {
    const out = parseBusyFeed(
      calendar(
        event([
          'UID:c@x',
          'DTSTART:20260924T100000Z',
          'DTEND:20260924T103000Z',
          'STATUS:CANCELLED',
        ]),
      ),
      WINDOW,
    );

    expect(out).toHaveLength(0);
  });

  /** Google's "show as Free" means the doctor is not actually busy. */
  it('ignores an event marked free rather than busy', () => {
    const out = parseBusyFeed(
      calendar(
        event([
          'UID:t@x',
          'DTSTART:20260924T100000Z',
          'DTEND:20260924T103000Z',
          'TRANSP:TRANSPARENT',
        ]),
      ),
      WINDOW,
    );

    expect(out).toHaveLength(0);
  });

  it('drops events outside the window', () => {
    const out = parseBusyFeed(
      calendar(
        event(['UID:old@x', 'DTSTART:20200101T100000Z', 'DTEND:20200101T110000Z']),
        event(['UID:far@x', 'DTSTART:20300101T100000Z', 'DTEND:20300101T110000Z']),
      ),
      WINDOW,
    );

    expect(out).toHaveLength(0);
  });

  it('drops a zero-length event rather than blocking on it', () => {
    const out = parseBusyFeed(
      calendar(event(['UID:z@x', 'DTSTART:20260924T100000Z', 'DTEND:20260924T100000Z'])),
      WINDOW,
    );

    expect(out).toHaveLength(0);
  });

  /** A feed that is empty, or not a calendar at all, must not throw. */
  it('returns nothing for an empty calendar', () => {
    expect(parseBusyFeed(calendar(), WINDOW)).toEqual([]);
  });
});
