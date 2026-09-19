import { describe, expect, it } from 'vitest';
import { plannedReminders } from './slots';

const IST = 'Asia/Kolkata';
/** A date-only value as Prisma stores it: UTC midnight. */
const day = (d: number) => new Date(Date.UTC(2026, 8, d));
/** An instant at HH:mm IST on 19 Sep. */
const ist = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 19, h - 5, m - 30));

/**
 * A reminder whose moment passed before the patient booked is not a reminder.
 *
 * From use: an appointment booked at 13:47 UTC for the next day had its
 * "evening before" moment three hours earlier, so the sweep fired it three
 * minutes after booking and told the patient their appointment was *tomorrow*.
 * And a 09:35 booking for 09:40 promised both reminders when neither could
 * possibly arrive.
 */
describe('plannedReminders', () => {
  it('plans both when the booking is made well in advance', () => {
    const booked = new Date(Date.UTC(2026, 8, 17, 6, 0)); // two days ahead
    expect(plannedReminders(day(19), ist(10), IST, booked)).toEqual({
      dayBefore: true,
      hourBefore: true,
    });
  });

  /** Booked after 6 PM the previous evening: that moment is gone. */
  it('drops the day-before when booking after it would have fired', () => {
    const booked = new Date(Date.UTC(2026, 8, 18, 15, 0)); // 20:30 IST on the 18th
    const planned = plannedReminders(day(19), ist(10), IST, booked);

    expect(planned.dayBefore).toBe(false);
    expect(planned.hourBefore).toBe(true);
  });

  /** The reported case: booked at 09:35 for 09:40 the same morning. */
  it('plans neither for a booking minutes before the slot', () => {
    expect(plannedReminders(day(19), ist(9, 40), IST, ist(9, 35))).toEqual({
      dayBefore: false,
      hourBefore: false,
    });
  });

  /** Exactly an hour out is still too late for an hour's warning. */
  it('drops the hour-before when booked exactly on the hour mark', () => {
    expect(plannedReminders(day(19), ist(10), IST, ist(9)).hourBefore).toBe(false);
  });

  it('keeps the hour-before when booked just over an hour out', () => {
    expect(plannedReminders(day(19), ist(10), IST, ist(8, 50)).hourBefore).toBe(true);
  });
});
