import type { Appointment, Clinic, Doctor, Patient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bookSlot, getAvailableSlots, getNextAvailableDates, moveSlot } from '../../domain/slots';
import { Steps } from '../steps';
import type { ConversationContext } from '../types';
import { slotFlow } from './slot';

/**
 * SLOT flow state machine tests.
 *
 * The domain layer is mocked, as in token.test.ts: the flow is a pure decision
 * over (step, input, data) and needs neither a database nor a provider.
 */

vi.mock('../../domain/slots', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../domain/slots')>();
  return {
    ...actual,
    getAvailableSlots: vi.fn(),
    getNextAvailableDates: vi.fn(),
    bookSlot: vi.fn(),
    moveSlot: vi.fn(),
  };
});

vi.mock('../../domain/appointments', () => ({ cancelAppointment: vi.fn() }));
vi.mock('../../db/prisma', () => ({
  prisma: { appointment: { findFirst: vi.fn().mockResolvedValue(null) } },
}));

const doctor = {
  id: 'doc-2',
  name: 'Meera',
  clinicName: 'Lakeview Clinic',
  bookingMode: 'SLOT',
  consultDurationMins: 20,
  leaveDates: [],
  timezone: 'Asia/Kolkata',
} as unknown as Doctor;

const clinic = {
  id: 'clinic-1',
  name: 'Lakeview Clinic',
  timezone: 'Asia/Kolkata',
  defaultLanguage: 'EN',
} as unknown as Clinic;

const patient = { id: 'pat-1', phone: '919876543210', name: 'Asha', language: 'EN' } as Patient;
const today = new Date(Date.UTC(2026, 8, 18));

function ctx(
  step: string,
  input: string,
  data: Record<string, unknown> = {},
  doctorCount = 3,
): ConversationContext {
  return {
    clinic,
    doctor,
    doctorCount,
    patient,
    step,
    data,
    language: 'EN',
    input,
    receivedAt: new Date('2026-09-18T04:00:00Z'),
    today,
  };
}

/**
 * n slots from 09:00 IST on 18 Sep, `stepMins` apart.
 *
 * At the default 20 minutes, 15 slots run 09:00–13:40 and therefore straddle
 * noon — which is what makes them useful for the morning/afternoon split.
 */
const slotsFrom = (n: number, stepMins = 20) =>
  Array.from({ length: n }, (_, i) => {
    const start = new Date(Date.UTC(2026, 8, 18, 3, 30) + i * stepMins * 60_000);
    return { start, end: new Date(start.getTime() + stepMins * 60_000) };
  });

/** n slots that all fall before noon IST, so only one period is on offer. */
const morningOnly = (n: number) => slotsFrom(n, 10);

beforeEach(() => {
  vi.mocked(getNextAvailableDates).mockReset().mockResolvedValue([today]);
  vi.mocked(getAvailableSlots).mockReset().mockResolvedValue(slotsFrom(3));
  vi.mocked(bookSlot).mockReset();
  vi.mocked(moveSlot).mockReset();
});

describe('menu', () => {
  it('offers three tappable options whose ids match the typed numbers', async () => {
    const r = await slotFlow.handle(ctx(Steps.SLOT_MENU, ''));
    expect(r.nextStep).toBe(Steps.SLOT_MENU);
    expect(r.replies[0]?.buttons?.map((b) => b.id)).toEqual(['1', '2', '3']);
  });

  it('"1" moves to picking a date', async () => {
    const r = await slotFlow.handle(ctx(Steps.SLOT_MENU, '1'));
    expect(r.nextStep).toBe(Steps.SLOT_AWAITING_DATE);
    expect(r.replies.at(-1)?.list?.rows.length).toBe(1);
  });

  it('falls back to the menu when no day has a free slot', async () => {
    vi.mocked(getNextAvailableDates).mockResolvedValue([]);
    const r = await slotFlow.handle(ctx(Steps.SLOT_MENU, '1'));
    expect(r.nextStep).toBe(Steps.SLOT_MENU);
    expect(r.replies[0]?.templateName).toBe('slotNoneAvailable');
  });

  /**
   * The menu no longer prints "1. Book / 2. Check / 3. Cancel" — the buttons
   * say it — so typing a word has to work as well as typing a number.
   */
  it.each([
    ['book', Steps.SLOT_AWAITING_DATE],
    ['ಬುಕ್', Steps.SLOT_AWAITING_DATE],
    ['cancel', Steps.SLOT_MENU],
  ])('acts on the typed word %s', async (input, expected) => {
    const r = await slotFlow.handle(ctx(Steps.SLOT_MENU, input));
    expect(r.nextStep).toBe(expected);
    expect(r.replies.some((x) => x.templateName === 'unknownInput')).toBe(false);
  });
});

/**
 * "Sorry, I did not understand that" was the most common thing a patient saw,
 * because a greeting matched nothing at any step. It is a request to start over.
 */
describe('greetings', () => {
  it.each(['hi', 'HI', 'hello', 'menu', 'ನಮಸ್ಕಾರ'])(
    'treats %s as start over, with no error',
    async (input) => {
      const r = await slotFlow.handle(ctx(Steps.SLOT_MENU, input));
      expect(r.nextStep).toBe(Steps.SLOT_MENU);
      expect(r.replies).toHaveLength(1);
      expect(r.replies[0]?.templateName).toBe('slotMainMenu');
    },
  );

  /** Mid-booking too: the old code answered "hi" with "invalid choice". */
  it.each([Steps.SLOT_AWAITING_DATE, Steps.SLOT_AWAITING_PERIOD, Steps.SLOT_AWAITING_TIME])(
    'starts over from %s without complaining',
    async (step) => {
      const r = await slotFlow.handle(ctx(step, 'hi', { date: '2026-09-18' }));
      expect(r.nextStep).toBe(Steps.SLOT_MENU);
      expect(r.replies[0]?.templateName).toBe('slotMainMenu');
    },
  );

  it('still complains about input that means nothing', async () => {
    const r = await slotFlow.handle(ctx(Steps.SLOT_MENU, 'kya haal hai'));
    expect(r.replies[0]?.templateName).toBe('unknownInput');
  });
});

describe('booking horizon', () => {
  /** Clinics change their own plans inside a week; long-range bookings get moved by hand. */
  it('looks no further ahead than three days', async () => {
    await slotFlow.handle(ctx(Steps.SLOT_MENU, '1'));
    const [, , count, lookAhead] = vi.mocked(getNextAvailableDates).mock.calls[0]!;
    expect(count).toBe(3);
    expect(lookAhead).toBe(3);
  });
});

/**
 * Asking which part of the day comes before showing times. A clinic with a
 * morning and an evening session produced more free times than a WhatsApp list
 * can hold, so wanting 6 PM meant paging past every morning slot to reach it.
 */
describe('picking a part of the day', () => {
  it('asks which part of the day when the day spans more than one', async () => {
    vi.mocked(getAvailableSlots).mockResolvedValue(slotsFrom(15));
    const r = await slotFlow.handle(
      ctx(Steps.SLOT_AWAITING_DATE, '1', { dates: ['2026-09-18'] }),
    );

    expect(r.nextStep).toBe(Steps.SLOT_AWAITING_PERIOD);
    expect(r.replies.at(-1)?.buttons?.map((b) => b.title)).toEqual(['Morning', 'Afternoon']);
    expect(r.data?.['periods']).toEqual(['MORNING', 'AFTERNOON']);
  });

  /** A question with one possible answer is worse than no question. */
  it('skips the question when only one part of the day is free', async () => {
    vi.mocked(getAvailableSlots).mockResolvedValue(morningOnly(4));
    const r = await slotFlow.handle(
      ctx(Steps.SLOT_AWAITING_DATE, '1', { dates: ['2026-09-18'] }),
    );

    expect(r.nextStep).toBe(Steps.SLOT_AWAITING_TIME);
    expect(r.replies.at(-1)?.list?.rows).toHaveLength(4);
  });

  it('narrows the times to the part of the day chosen', async () => {
    vi.mocked(getAvailableSlots).mockResolvedValue(slotsFrom(15));
    const r = await slotFlow.handle(
      ctx(Steps.SLOT_AWAITING_PERIOD, '2', {
        date: '2026-09-18',
        periods: ['MORNING', 'AFTERNOON'],
      }),
    );

    expect(r.nextStep).toBe(Steps.SLOT_AWAITING_TIME);
    expect(r.data?.['period']).toBe('AFTERNOON');
    // 09:00-13:40 at 20 minutes: nine before noon, six after.
    expect(r.replies.at(-1)!.list!.rows).toHaveLength(6);
    for (const iso of r.data?.['times'] as string[]) {
      expect(new Date(iso).getTime()).toBeGreaterThanOrEqual(
        Date.parse('2026-09-18T06:30:00.000Z'), // noon IST
      );
    }
  });

  it('re-asks on a choice outside the parts offered', async () => {
    const r = await slotFlow.handle(
      ctx(Steps.SLOT_AWAITING_PERIOD, '3', {
        date: '2026-09-18',
        periods: ['MORNING', 'AFTERNOON'],
      }),
    );
    expect(r.nextStep).toBe(Steps.SLOT_AWAITING_PERIOD);
    expect(r.replies[0]?.templateName).toBe('slotInvalidChoice');
  });

  /** The period is carried so a pager or a retaken slot stays in that part. */
  it('keeps the chosen part of the day when re-offering after a taken slot', async () => {
    vi.mocked(getAvailableSlots).mockResolvedValue(slotsFrom(15));
    vi.mocked(bookSlot).mockResolvedValue({ ok: false, reason: 'TAKEN' });

    const r = await slotFlow.handle(
      ctx(Steps.SLOT_CONFIRM_BOOKING, '1', {
        date: '2026-09-18',
        period: 'AFTERNOON',
        slotStart: '2026-09-18T06:30:00.000Z',
      }),
    );

    expect(r.nextStep).toBe(Steps.SLOT_AWAITING_TIME);
    expect(r.data?.['period']).toBe('AFTERNOON');
    expect(r.replies.at(-1)!.list!.rows).toHaveLength(6);
  });
});

describe('picking a time', () => {
  /**
   * Meta allows ten list rows. A clinic on 10-minute consults exceeds that
   * within a single morning, so the tenth row is a pager rather than a slot.
   */
  it('pages at nine times plus a "more" row', async () => {
    vi.mocked(getAvailableSlots).mockResolvedValue(morningOnly(15));
    const r = await slotFlow.handle(
      ctx(Steps.SLOT_AWAITING_DATE, '1', { dates: ['2026-09-18'] }),
    );
    const rows = r.replies.at(-1)!.list!.rows;
    expect(rows).toHaveLength(10);
    expect(rows.at(-1)!.id).toBe('more');
    expect(r.data?.['hasMore']).toBe(true);
  });

  it('does not add a pager when everything fits', async () => {
    vi.mocked(getAvailableSlots).mockResolvedValue(morningOnly(4));
    const r = await slotFlow.handle(
      ctx(Steps.SLOT_AWAITING_DATE, '1', { dates: ['2026-09-18'] }),
    );
    const rows = r.replies.at(-1)!.list!.rows;
    expect(rows).toHaveLength(4);
    expect(rows.some((x) => x.id === 'more')).toBe(false);
  });

  it('"more" advances the offset rather than restarting', async () => {
    vi.mocked(getAvailableSlots).mockResolvedValue(slotsFrom(15));
    const r = await slotFlow.handle(
      ctx(Steps.SLOT_AWAITING_TIME, 'more', {
        date: '2026-09-18',
        offset: 0,
        hasMore: true,
        times: [],
      }),
    );
    expect(r.data?.['offset']).toBe(9);
    expect(r.replies.at(-1)!.list!.rows).toHaveLength(6);
  });

  it('re-asks on a number outside the offered range', async () => {
    const r = await slotFlow.handle(
      ctx(Steps.SLOT_AWAITING_TIME, '99', {
        date: '2026-09-18',
        times: ['2026-09-18T03:30:00.000Z'],
      }),
    );
    expect(r.nextStep).toBe(Steps.SLOT_AWAITING_TIME);
    expect(r.replies[0]?.templateName).toBe('slotInvalidChoice');
  });

  /**
   * The chosen time is carried as an instant, not an index: regenerating the
   * list on the next turn could shift positions if a slot went in between.
   */
  it('carries the chosen time as an instant into confirmation', async () => {
    const times = ['2026-09-18T03:30:00.000Z', '2026-09-18T03:50:00.000Z'];
    const r = await slotFlow.handle(
      ctx(Steps.SLOT_AWAITING_TIME, '2', { date: '2026-09-18', times }),
    );
    expect(r.nextStep).toBe(Steps.SLOT_CONFIRM_BOOKING);
    expect(r.data?.['slotStart']).toBe(times[1]);
  });
});

describe('confirming', () => {
  const confirmData = { date: '2026-09-18', slotStart: '2026-09-18T03:30:00.000Z' };

  const booked = {
    id: 'appt-9',
    date: today,
    type: 'SLOT',
    status: 'BOOKED',
    slotStart: new Date('2026-09-18T03:30:00.000Z'),
  } as unknown as Appointment;

  it('books on yes and schedules the reminders', async () => {
    vi.mocked(bookSlot).mockResolvedValue({ ok: true, appointment: booked });
    const r = await slotFlow.handle(ctx(Steps.SLOT_CONFIRM_BOOKING, '1', confirmData));
    expect(r.replies[0]?.templateName).toBe('slotBooked');
    expect(r.effects).toEqual([{ type: 'SCHEDULE_REMINDERS', appointmentId: 'appt-9' }]);
  });

  it('returns to the menu on no, without booking', async () => {
    const r = await slotFlow.handle(ctx(Steps.SLOT_CONFIRM_BOOKING, '2', confirmData));
    expect(r.nextStep).toBe(Steps.SLOT_MENU);
    expect(bookSlot).not.toHaveBeenCalled();
  });

  /**
   * Availability is derived live, so someone taking the slot mid-conversation
   * is the normal case. It must re-offer the day, not dead-end.
   */
  it('re-offers times when the slot was taken while deciding', async () => {
    vi.mocked(bookSlot).mockResolvedValue({ ok: false, reason: 'TAKEN' });
    const r = await slotFlow.handle(ctx(Steps.SLOT_CONFIRM_BOOKING, '1', confirmData));
    expect(r.nextStep).toBe(Steps.SLOT_AWAITING_TIME);
    expect(r.replies[0]?.templateName).toBe('slotTaken');
    expect(r.replies.at(-1)?.list?.rows.length).toBeGreaterThan(0);
  });

  it('reports an existing booking rather than creating a second', async () => {
    vi.mocked(bookSlot).mockResolvedValue({
      ok: true,
      appointment: booked,
      alreadyExisted: true,
    });
    const r = await slotFlow.handle(ctx(Steps.SLOT_CONFIRM_BOOKING, '1', confirmData));
    expect(r.replies[0]?.templateName).toBe('slotAlreadyBooked');
    expect(r.effects ?? []).toEqual([]);
  });

  it('explains leave instead of failing generically', async () => {
    vi.mocked(bookSlot).mockResolvedValue({ ok: false, reason: 'ON_LEAVE' });
    const r = await slotFlow.handle(ctx(Steps.SLOT_CONFIRM_BOOKING, '1', confirmData));
    expect(r.replies[0]?.templateName).toBe('doctorOnLeave');
  });

  it('re-asks rather than dropping the booking on an unclear answer', async () => {
    const r = await slotFlow.handle(ctx(Steps.SLOT_CONFIRM_BOOKING, 'maybe', confirmData));
    expect(r.nextStep).toBe(Steps.SLOT_CONFIRM_BOOKING);
    expect(bookSlot).not.toHaveBeenCalled();
  });
});

describe('tapping and typing are the same input', () => {
  it('a typed number and a tapped row id produce the same result', async () => {
    const data = { date: '2026-09-18', times: ['2026-09-18T03:30:00.000Z'] };
    const typed = await slotFlow.handle(ctx(Steps.SLOT_AWAITING_TIME, '1', data));
    const tapped = await slotFlow.handle(ctx(Steps.SLOT_AWAITING_TIME, ' 1 ', data));
    expect(tapped.nextStep).toBe(typed.nextStep);
    expect(tapped.data?.['slotStart']).toBe(typed.data?.['slotStart']);
  });
});

/**
 * The switch keyword is useless if nobody knows it exists, and the menu is the
 * one screen a patient always sees. This is the whole of its discoverability.
 */
describe('switching doctor', () => {
  it('offers the way back to the doctor list at a multi-doctor clinic', async () => {
    const r = await slotFlow.handle(ctx(Steps.SLOT_MENU, '', {}, 3));
    expect(r.replies[0]?.text).toContain('doctor');
    expect(r.replies[0]?.text).toMatch(/Reply \*doctor\*/);
  });

  /** At a solo practice it would promise something that does not exist. */
  it('says nothing about switching when the clinic has one doctor', async () => {
    const r = await slotFlow.handle(ctx(Steps.SLOT_MENU, '', {}, 1));
    expect(r.replies[0]?.text).not.toMatch(/Reply \*doctor\*/);
  });

  it('still names the doctor, hint or not', async () => {
    for (const count of [1, 3]) {
      const r = await slotFlow.handle(ctx(Steps.SLOT_MENU, '', {}, count));
      expect(r.replies[0]?.text).toContain('Dr. Meera');
    }
  });
});

/**
 * Picking a different time on a day you already have an appointment is a
 * reschedule, not a mistake. It used to be answered with "you already have an
 * appointment, reply 3 to cancel it first" — which named a number the menu no
 * longer shows, and sent the patient away to do in two steps what the bot can
 * do in one.
 */
describe('moving an existing appointment', () => {
  const existing = {
    id: 'appt-old',
    date: today,
    slotStart: new Date('2026-09-18T06:45:00.000Z'), // 12:15 PM IST
  } as unknown as Appointment;

  const confirmData = { date: '2026-09-18', slotStart: '2026-09-18T09:00:00.000Z' };

  it('offers to move instead of telling them to cancel', async () => {
    vi.mocked(bookSlot).mockResolvedValue({ ok: false, reason: 'PATIENT_HAS_SLOT', existing });

    const r = await slotFlow.handle(ctx(Steps.SLOT_CONFIRM_BOOKING, '1', confirmData));

    expect(r.nextStep).toBe(Steps.SLOT_CONFIRM_MOVE);
    expect(r.replies[0]?.templateName).toBe('slotMoveConfirm');
    expect(r.replies[0]?.text).toMatch(/12:15 PM/);
    expect(r.replies[0]?.text).toMatch(/02:30 PM/);
    expect(r.data?.['existingId']).toBe('appt-old');
  });

  it('moves it on yes, and sends the reminders after it', async () => {
    const moved = { id: 'appt-new', date: today, slotStart: new Date('2026-09-18T09:00:00.000Z') } as unknown as Appointment;
    vi.mocked(moveSlot).mockResolvedValue({ ok: true, appointment: moved });

    const r = await slotFlow.handle(
      ctx(Steps.SLOT_CONFIRM_MOVE, '1', { ...confirmData, existingId: 'appt-old' }),
    );

    expect(r.replies[0]?.templateName).toBe('slotMoved');
    expect(r.effects).toEqual([
      { type: 'CANCEL_REMINDERS', appointmentId: 'appt-old' },
      { type: 'SCHEDULE_REMINDERS', appointmentId: 'appt-new' },
    ]);
  });

  /** Declining the move must never be read as declining the appointment. */
  it('keeps the original on no, and moves nothing', async () => {
    const r = await slotFlow.handle(
      ctx(Steps.SLOT_CONFIRM_MOVE, '2', { ...confirmData, existingId: 'appt-old' }),
    );

    expect(moveSlot).not.toHaveBeenCalled();
    expect(r.nextStep).toBe(Steps.SLOT_MENU);
    expect(r.replies[0]?.templateName).toBe('slotMoveKept');
    expect(r.effects ?? []).toEqual([]);
  });

  /**
   * The new slot went while they were deciding. moveSlot leaves the original
   * intact, so re-offer the day rather than implying anything was lost.
   */
  it('re-offers times when the new slot was taken mid-move', async () => {
    vi.mocked(moveSlot).mockResolvedValue({ ok: false, reason: 'TAKEN' });

    const r = await slotFlow.handle(
      ctx(Steps.SLOT_CONFIRM_MOVE, '1', { ...confirmData, existingId: 'appt-old' }),
    );

    expect(r.nextStep).toBe(Steps.SLOT_AWAITING_TIME);
    expect(r.replies[0]?.templateName).toBe('slotTaken');
    expect(r.effects ?? []).toEqual([]);
  });

  /** Re-tapping the very same slot is still a double submit, not a move. */
  it('treats the same slot again as already booked, not a move', async () => {
    vi.mocked(bookSlot).mockResolvedValue({
      ok: true,
      appointment: existing,
      alreadyExisted: true,
    });

    const r = await slotFlow.handle(ctx(Steps.SLOT_CONFIRM_BOOKING, '1', confirmData));

    expect(r.nextStep).toBe(Steps.SLOT_MENU);
    expect(r.replies[0]?.templateName).toBe('slotAlreadyBooked');
    expect(moveSlot).not.toHaveBeenCalled();
  });
});
