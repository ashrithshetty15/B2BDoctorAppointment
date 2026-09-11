import { DateTime } from 'luxon';

/**
 * All date arithmetic goes through the doctor's timezone. Prisma `@db.Date`
 * columns round-trip as JS Dates at UTC midnight, so calendar dates are always
 * built/read as UTC midnight to avoid off-by-one-day drift.
 */

/** "today" in the doctor's timezone, as a UTC-midnight Date for a @db.Date column. */
export function clinicToday(timezone: string): Date {
  const local = DateTime.now().setZone(timezone);
  return dateOnly(local.year, local.month, local.day);
}

export function dateOnly(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/** Parse "YYYY-MM-DD" into a UTC-midnight Date. Returns null if malformed. */
export function parseDateOnly(input: string): Date | null {
  const dt = DateTime.fromFormat(input.trim(), 'yyyy-MM-dd', { zone: 'utc' });
  if (!dt.isValid) return null;
  return dateOnly(dt.year, dt.month, dt.day);
}

export function formatDateOnly(date: Date): string {
  return DateTime.fromJSDate(date, { zone: 'utc' }).toFormat('yyyy-MM-dd');
}

/** Patient-facing date, e.g. "Fri, 11 Sep". */
export function formatDateForPatient(date: Date): string {
  return DateTime.fromJSDate(date, { zone: 'utc' }).toFormat('ccc, dd LLL');
}

/** Patient-facing clock time in the doctor's timezone, e.g. "10:45 AM". */
export function formatTimeForPatient(at: Date, timezone: string): string {
  return DateTime.fromJSDate(at).setZone(timezone).toFormat('hh:mm a');
}

/** Current wall-clock time in the doctor's timezone. */
export function nowInZone(timezone: string): DateTime {
  return DateTime.now().setZone(timezone);
}

/** Combine a calendar date with "HH:mm" in a timezone into a real instant. */
export function atLocalTime(date: Date, hhmm: string, timezone: string): Date | null {
  const [h, m] = hhmm.split(':');
  const hour = Number(h);
  const minute = Number(m);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;

  const d = DateTime.fromJSDate(date, { zone: 'utc' });
  const dt = DateTime.fromObject(
    { year: d.year, month: d.month, day: d.day, hour, minute },
    { zone: timezone },
  );
  return dt.isValid ? dt.toJSDate() : null;
}

/** Human wait string: 45 -> "45 mins", 90 -> "1 hr 30 mins". */
export function formatWait(mins: number): string {
  const rounded = Math.max(0, Math.round(mins));
  if (rounded < 60) return `${rounded} mins`;
  const hrs = Math.floor(rounded / 60);
  const rem = rounded % 60;
  return rem === 0 ? `${hrs} hr` : `${hrs} hr ${rem} mins`;
}

export function isSameDateOnly(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}
