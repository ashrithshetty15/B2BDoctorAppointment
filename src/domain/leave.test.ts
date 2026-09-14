import { describe, expect, it } from 'vitest';
import type { Doctor } from '@prisma/client';
import { MESSAGING_WINDOW_HOURS, isReachable, upcomingLeave } from './leave';

/**
 * The reachability rule decides who a day-closure can actually tell, and who has
 * to be phoned instead. Getting it wrong in the optimistic direction means a
 * patient is dropped from the queue and never finds out, so the boundaries are
 * pinned here.
 */
describe('isReachable', () => {
  const now = new Date('2026-09-14T12:00:00Z');
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

  it('is true inside the messaging window', () => {
    expect(isReachable({ lastInboundAt: hoursAgo(1) }, now)).toBe(true);
    expect(isReachable({ lastInboundAt: hoursAgo(23) }, now)).toBe(true);
  });

  it('is false once the window has passed', () => {
    expect(isReachable({ lastInboundAt: hoursAgo(25) }, now)).toBe(false);
    expect(isReachable({ lastInboundAt: hoursAgo(24 * 7) }, now)).toBe(false);
  });

  it('closes exactly at the boundary rather than just after', () => {
    expect(isReachable({ lastInboundAt: hoursAgo(MESSAGING_WINDOW_HOURS) }, now)).toBe(false);
  });

  /**
   * A patient booked at the desk has never messaged us, so there is no window at
   * all. They must land on the call list, never be assumed reachable.
   */
  it('is false for a patient who has never messaged', () => {
    expect(isReachable({ lastInboundAt: null }, now)).toBe(false);
  });
});

describe('upcomingLeave', () => {
  const today = new Date(Date.UTC(2026, 8, 14));
  const doctorWith = (dates: Date[]) => ({ leaveDates: dates }) as Doctor;

  it('drops past days and keeps today', () => {
    const out = upcomingLeave(
      doctorWith([
        new Date(Date.UTC(2026, 8, 1)),
        new Date(Date.UTC(2026, 8, 14)),
        new Date(Date.UTC(2026, 8, 20)),
      ]),
      today,
    );
    expect(out.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-09-14', '2026-09-20']);
  });

  it('sorts soonest first regardless of stored order', () => {
    const out = upcomingLeave(
      doctorWith([new Date(Date.UTC(2026, 11, 25)), new Date(Date.UTC(2026, 8, 20))]),
      today,
    );
    expect(out.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-09-20', '2026-12-25']);
  });

  it('returns nothing when no days are closed', () => {
    expect(upcomingLeave(doctorWith([]), today)).toEqual([]);
  });
});
