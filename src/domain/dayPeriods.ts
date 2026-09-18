import { DateTime } from 'luxon';

/**
 * Grouping a day's free times into morning / afternoon / evening.
 *
 * A clinic running 20-minute consults over a morning and an evening session
 * produces more times than a WhatsApp list can hold, so the list paged — and a
 * patient wanting 6 PM had to tap "More times" twice to find it. Asking which
 * part of the day they want first turns that into one tap, and fits the three
 * reply buttons WhatsApp allows exactly.
 *
 * Boundaries are wall-clock in the *clinic's* timezone, not the server's: a slot
 * at 17:30 IST is an evening appointment no matter where this process runs.
 */

export const PERIODS = ['MORNING', 'AFTERNOON', 'EVENING'] as const;
export type Period = (typeof PERIODS)[number];

/** Afternoon starts at noon, evening at 5 PM — the split an Indian clinic uses. */
const AFTERNOON_FROM = 12;
const EVENING_FROM = 17;

export function periodOf(at: Date, timezone: string): Period {
  const hour = DateTime.fromJSDate(at).setZone(timezone).hour;
  if (hour < AFTERNOON_FROM) return 'MORNING';
  if (hour < EVENING_FROM) return 'AFTERNOON';
  return 'EVENING';
}

/**
 * Split into the three buckets, preserving order within each.
 *
 * Empty buckets are kept rather than dropped so callers can tell "no evening
 * slots" from "evening not considered" — offering a period with nothing behind
 * it is how a patient ends up at a dead end.
 */
export function splitByPeriod<T>(
  items: T[],
  timezone: string,
  startOf: (item: T) => Date,
): Record<Period, T[]> {
  const out: Record<Period, T[]> = { MORNING: [], AFTERNOON: [], EVENING: [] };
  for (const item of items) out[periodOf(startOf(item), timezone)].push(item);
  return out;
}

/** Periods that actually have something to offer, in chronological order. */
export function availablePeriods<T>(
  items: T[],
  timezone: string,
  startOf: (item: T) => Date,
): Period[] {
  const split = splitByPeriod(items, timezone, startOf);
  return PERIODS.filter((p) => split[p].length > 0);
}
