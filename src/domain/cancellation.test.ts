import { describe, expect, it } from 'vitest';
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
    expect(isReachable(hoursAgo(1), now)).toBe(true);
    expect(isReachable(hoursAgo(23), now)).toBe(true);
  });

  it('is false once the window has passed', () => {
    expect(isReachable(hoursAgo(25), now)).toBe(false);
    expect(isReachable(hoursAgo(24 * 7), now)).toBe(false);
  });

  it('closes exactly at the boundary rather than just after', () => {
    expect(isReachable(hoursAgo(MESSAGING_WINDOW_HOURS), now)).toBe(false);
  });

  /**
   * A patient booked at the desk has never messaged this clinic, so there is no
   * window at all. They must land on the call list, never be assumed reachable.
   */
  it('is false for a patient who has never messaged this clinic', () => {
    expect(isReachable(null, now)).toBe(false);
    expect(isReachable(undefined, now)).toBe(false);
  });
});

describe('partitionByReachability', () => {
  const now = new Date('2026-09-14T12:00:00Z');
  const appt = (id: string) => ({ id, patientId: `p${id}` }) as WithPatient;
  const windows = (entries: [string, Date][]) => new Map(entries);

  it('splits the list without losing or duplicating anyone', () => {
    const rows = [appt('a'), appt('b'), appt('c')];
    const { reachable, unreachable } = partitionByReachability(
      rows,
      windows([
        ['pa', new Date(now.getTime() - 3_600_000)],
        // pb has no row at all; pc's is stale.
        ['pc', new Date(now.getTime() - 48 * 3_600_000)],
      ]),
      now,
    );

    expect(reachable.map((r) => r.id)).toEqual(['a']);
    expect(unreachable.map((r) => r.id)).toEqual(['b', 'c']);
    expect(reachable.length + unreachable.length).toBe(rows.length);
  });

  /**
   * The whole point of the rescope: a window belonging to another clinic must not
   * make this clinic's patient look reachable. The map is loaded per doctor, so a
   * missing entry is the correct answer here.
   */
  it('treats a patient with no window for this clinic as unreachable', () => {
    const { reachable, unreachable } = partitionByReachability([appt('a')], windows([]), now);
    expect(reachable).toEqual([]);
    expect(unreachable.map((r) => r.id)).toEqual(['a']);
  });

  it('preserves the order it was given, so the UI matches the queue', () => {
    const rows = [appt('x'), appt('y'), appt('z')];
    expect(partitionByReachability(rows, windows([]), now).unreachable.map((r) => r.id)).toEqual([
      'x',
      'y',
      'z',
    ]);
  });

  it('handles an empty list', () => {
    expect(partitionByReachability([], windows([]), now)).toEqual({
      reachable: [],
      unreachable: [],
    });
  });
});
