import { DateTime } from 'luxon';
import { type DayKey, type Window, type WorkingHours, DAY_KEYS, dayKeyFor } from './slots';

/**
 * Writing working hours.
 *
 * The read side lives in slots.ts and is deliberately tolerant — a malformed blob
 * yields no availability rather than a crash. This is the opposite end: it refuses
 * anything it cannot make sense of, so the tolerant reader never has to paper over
 * something a human typed.
 *
 * Lifted out of the operator console, which owned the only strict validator in the
 * codebase while the admin JSON API used a much weaker Zod schema that happily
 * accepted "77:99". Both now come through here.
 */

/** A real 24-hour clock time. The read-side regex is looser on purpose. */
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':') as [string, string];
  return Number(h) * 60 + Number(m);
}

/**
 * "09:30-13:00, 17:00-20:00" -> windows, sorted, non-overlapping.
 *
 * Throws with a human-readable reason; callers render it straight back into the
 * form, so `label` should be the day as the user sees it.
 */
export function parseDayWindows(label: string, input: string): Window[] {
  const text = input.trim();
  if (!text) return [];

  const windows: Window[] = [];
  for (const chunk of text.split(',')) {
    const piece = chunk.trim();
    if (!piece) continue;

    const [start, end, ...rest] = piece.split('-').map((s) => s.trim());
    if (!start || !end || rest.length > 0) {
      throw new Error(`${label}: "${piece}" must look like 09:30-13:00`);
    }
    if (!TIME.test(start) || !TIME.test(end)) {
      throw new Error(`${label}: "${piece}" must use 24-hour HH:MM times`);
    }
    if (minutesOfDay(end) <= minutesOfDay(start)) {
      throw new Error(`${label}: "${piece}" ends before it starts`);
    }
    windows.push({ start, end });
  }

  windows.sort((a, b) => minutesOfDay(a.start) - minutesOfDay(b.start));
  for (let i = 1; i < windows.length; i += 1) {
    const prev = windows[i - 1] as Window;
    const cur = windows[i] as Window;
    if (minutesOfDay(cur.start) < minutesOfDay(prev.end)) {
      throw new Error(`${label}: ${prev.start}-${prev.end} overlaps ${cur.start}-${cur.end}`);
    }
  }
  return windows;
}

/**
 * One text field per day -> the stored JSON. A day with no windows is omitted
 * entirely rather than stored as [], matching the schema's "a missing key means a
 * non-working day".
 */
export function buildWorkingHours(
  text: Record<DayKey, string>,
  labels: Record<DayKey, string>,
): WorkingHours {
  const out: WorkingHours = {};
  for (const day of DAY_KEYS) {
    const windows = parseDayWindows(labels[day], text[day] ?? '');
    if (windows.length > 0) out[day] = windows;
  }
  return out;
}

/** Stored windows -> the text a form field shows. Inverse of parseDayWindows. */
export function formatDayWindows(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .filter(
      (w): w is Window =>
        !!w && typeof w === 'object' && 'start' in w && 'end' in w,
    )
    .map((w) => `${String(w.start)}-${String(w.end)}`)
    .join(', ');
}

/** Prefill for the whole form, tolerant of whatever is stored. */
export function workingHoursToText(raw: unknown): Record<DayKey, string> {
  const out = {} as Record<DayKey, string>;
  const src =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  for (const day of DAY_KEYS) out[day] = formatDayWindows(src[day]);
  return out;
}

// ---- conflicts with existing bookings ----

/** Just enough of an appointment to judge it against a set of hours. */
export interface ConflictCandidate {
  id: string;
  date: Date;
  type: 'TOKEN' | 'SLOT';
  slotStart: Date | null;
  tokenNumber: number | null;
  patient: { name: string | null; phone: string };
}

export interface HoursConflict extends ConflictCandidate {
  /** DAY_CLOSED: the whole weekday has no hours. OUTSIDE: the time no longer fits. */
  reason: 'DAY_CLOSED' | 'OUTSIDE';
}

/**
 * Which of these bookings would fall outside the proposed hours.
 *
 * Why this matters: getDaySchedule derives the calendar from the *current* hours,
 * so an appointment whose time no longer sits inside a window does not move or
 * warn — it simply stops being rendered, and the patient turns up to a clinic that
 * is not expecting them. Shrinking hours is refused rather than allowed to do that.
 *
 * Pure, so the rule is testable without a database or a clock.
 */
export function findHoursConflicts(
  appointments: ConflictCandidate[],
  hours: WorkingHours,
  timezone: string,
): HoursConflict[] {
  const conflicts: HoursConflict[] = [];

  for (const appointment of appointments) {
    const windows = hours[dayKeyFor(appointment.date)] ?? [];

    if (windows.length === 0) {
      // No hours at all that weekday: every booking on it is orphaned, tokens
      // included — they have no time of their own, only the day.
      conflicts.push({ ...appointment, reason: 'DAY_CLOSED' });
      continue;
    }

    // A token is valid anywhere in the day, so an open day is enough for it.
    if (appointment.type !== 'SLOT' || !appointment.slotStart) continue;

    const local = DateTime.fromJSDate(appointment.slotStart).setZone(timezone);
    const at = local.hour * 60 + local.minute;
    const inside = windows.some(
      (w) => at >= minutesOfDay(w.start) && at < minutesOfDay(w.end),
    );
    if (!inside) conflicts.push({ ...appointment, reason: 'OUTSIDE' });
  }

  return conflicts;
}
