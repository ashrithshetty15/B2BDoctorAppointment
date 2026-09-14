import { describe, expect, it } from 'vitest';
import type { Patient } from '@prisma/client';
import {
  MESSAGING_WINDOW_HOURS,
  type WithPatient,
  isReachable,
  partitionByReachability,
} from './cancellation';

/**
 * Reachability decides who a cancellation can actually tell and who has to be
 * phoned. Wrong in the optimistic direction means a patient is dropped from the
 * queue and never finds out, so the boundaries are pinned here.
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

describe('partitionByReachability', () => {
  const now = new Date('2026-09-14T12:00:00Z');
  const appt = (id: string, lastInboundAt: Date | null) =>
    ({ id, patient: { id: `p${id}`, lastInboundAt } as Patient }) as WithPatient;

  it('splits the list without losing or duplicating anyone', () => {
    const rows = [
      appt('a', new Date(now.getTime() - 3_600_000)),
      appt('b', null),
      appt('c', new Date(now.getTime() - 48 * 3_600_000)),
    ];
    const { reachable, unreachable } = partitionByReachability(rows, now);

    expect(reachable.map((r) => r.id)).toEqual(['a']);
    expect(unreachable.map((r) => r.id)).toEqual(['b', 'c']);
    expect(reachable.length + unreachable.length).toBe(rows.length);
  });

  it('preserves the order it was given, so the UI matches the queue', () => {
    const rows = [appt('x', null), appt('y', null), appt('z', null)];
    expect(partitionByReachability(rows, now).unreachable.map((r) => r.id)).toEqual([
      'x',
      'y',
      'z',
    ]);
  });

  it('handles an empty list', () => {
    expect(partitionByReachability([], now)).toEqual({ reachable: [], unreachable: [] });
  });
});
