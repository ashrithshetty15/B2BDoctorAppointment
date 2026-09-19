import type { AppointmentStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  canTransition,
  primaryAction,
  secondaryActions,
  sectionFor,
  waitLevel,
  waitedMins,
} from './queueLifecycle';

/**
 * The lifecycle was previously implied by whichever buttons a view rendered:
 * any status could follow any other, so an appointment could reach IN_PROGRESS
 * with no arrivedAt — which is what made the average wait meaningless.
 */
describe('transitions', () => {
  it.each([
    ['BOOKED', 'ARRIVED'],
    ['BOOKED', 'NO_SHOW'],
    ['ARRIVED', 'IN_PROGRESS'],
    ['IN_PROGRESS', 'DONE'],
  ])('allows %s -> %s', (from, to) => {
    expect(canTransition(from as AppointmentStatus, to as AppointmentStatus)).toBe(true);
  });

  /** Skipping arrival is what produced in-room patients with no wait recorded. */
  it('refuses BOOKED straight to IN_PROGRESS', () => {
    expect(canTransition('BOOKED', 'IN_PROGRESS')).toBe(false);
  });

  it.each([
    ['DONE', 'BOOKED'],
    ['DONE', 'ARRIVED'],
    ['CANCELLED', 'ARRIVED'],
    ['IN_PROGRESS', 'NO_SHOW'],
  ])('refuses %s -> %s', (from, to) => {
    expect(canTransition(from as AppointmentStatus, to as AppointmentStatus)).toBe(false);
  });

  /** A patient marked missed who then walks in is ordinary, not an error. */
  it('lets a no-show come back', () => {
    expect(canTransition('NO_SHOW', 'ARRIVED')).toBe(true);
  });
});

describe('one primary action per state', () => {
  it.each([
    ['BOOKED', 'ARRIVED'],
    ['ARRIVED', 'IN_PROGRESS'],
    ['IN_PROGRESS', 'DONE'],
  ])('%s offers %s', (status, expected) => {
    expect(primaryAction(status as AppointmentStatus)).toBe(expected);
  });

  it.each(['DONE', 'NO_SHOW', 'CANCELLED'])('%s offers nothing primary', (status) => {
    expect(primaryAction(status as AppointmentStatus)).toBeNull();
  });

  /** The primary never also appears in the overflow — that is two of the same. */
  it('keeps the primary out of the overflow', () => {
    for (const status of ['BOOKED', 'ARRIVED', 'IN_PROGRESS'] as AppointmentStatus[]) {
      expect(secondaryActions(status)).not.toContain(primaryAction(status));
    }
  });
});

describe('sections', () => {
  it.each([
    ['IN_PROGRESS', 'IN_ROOM'],
    ['ARRIVED', 'WAITING'],
    ['BOOKED', 'EXPECTED'],
    ['DONE', 'CLOSED'],
    ['NO_SHOW', 'CLOSED'],
    ['CANCELLED', 'CLOSED'],
  ])('puts %s in %s', (status, expected) => {
    expect(sectionFor(status as AppointmentStatus)).toBe(expected);
  });
});

/**
 * The reported bug: a patient who booked at 07:13 for a 10:00 appointment was
 * shown as having waited 2 hr 27 min while sitting at home.
 */
describe('waiting time', () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 19, h, m));

  it('is null for someone who has not arrived', () => {
    expect(waitedMins({ arrivedAt: null, startedAt: null }, at(10))).toBeNull();
  });

  it('runs from arrival, not from booking', () => {
    expect(waitedMins({ arrivedAt: at(9, 40), startedAt: null }, at(10))).toBe(20);
  });

  /** Once called in, the wait stops — it does not keep counting in the room. */
  it('stops when they are called in', () => {
    expect(waitedMins({ arrivedAt: at(9, 40), startedAt: at(9, 55) }, at(11))).toBe(15);
  });

  it('never goes negative on a clock skew', () => {
    expect(waitedMins({ arrivedAt: at(10), startedAt: at(9, 50) }, at(11))).toBe(0);
  });
});

describe('wait severity', () => {
  it.each([
    [null, 'calm'],
    [0, 'calm'],
    [14, 'calm'],
    [15, 'warn'],
    [30, 'warn'],
    [31, 'urgent'],
  ])('%s minutes is %s', (mins, expected) => {
    expect(waitLevel(mins as number | null)).toBe(expected);
  });
});
