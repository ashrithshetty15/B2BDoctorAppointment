import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * JOURNEY 2 OF 3 — ONE DOCTOR, SLOT MODE
 *
 * The appointment clinic: pick a day, pick a time, hold it. Same single-doctor
 * shape as journey 1 — no picker, so the same engine branch — but a far longer
 * conversation, and the only one where a patient holds something that a second
 * booking has to reconcile with.
 *
 * Three behaviours reported by the clinic are pinned here deliberately: the
 * time list is one screen rather than two, a second booking offers to MOVE the
 * first rather than telling the patient to cancel it, and the confirmation
 * promises only reminders that can still be sent.
 *
 * Sibling journeys: soloToken.journey.test.ts, multiDoctor.journey.test.ts.
 */

vi.mock('../../db/prisma', async () => (await import('./world')).prismaModule());
vi.mock('../../domain/clinics', async () => (await import('./world')).clinicsModule());
vi.mock('../../domain/patients', async () => (await import('./world')).patientsModule());
vi.mock('../../queue/queues', async () => (await import('./world')).queuesModule());
vi.mock('../../domain/slots', async () => (await import('./world')).slotsModule());
vi.mock('../../domain/tokenQueue', async () => (await import('./world')).tokenQueueModule());
vi.mock('../../domain/appointments', async () => (await import('./world')).appointmentsModule());
vi.mock('../../utils/logger', async () => (await import('./world')).loggerModule());

import { optionsOf, resetTranscript, say, tapEveryOption } from './drive';
import { resetWorld, world } from './world';

const setUp = () =>
  resetWorld({
    clinicName: 'Lakeview Clinic',
    doctors: [{ name: 'Arjun Rao', mode: 'SLOT' }],
  });

const arrive = async () => {
  await say('hi');
  await say('1'); // English
  await say('Asha Rao');
};

/** Menu, date, time, and the yes that books it. */
const bookFirst = async () => {
  await arrive();
  await say('1'); // Book appointment
  await say('1'); // Mon 21 Sep
  await say('1'); // 09:15 AM
  await say('1'); // Yes, confirm
};

beforeEach(() => {
  setUp();
  resetTranscript();
});

describe('one doctor, slot mode', () => {
  it('books an appointment, start to finish', async () => {
    await arrive();

    const menu = await say('menu');
    expect(menu.step).toBe('SLOT_MENU');
    // The third button is Cancel, not Change doctor: there is nobody to change
    // to, and offering it would promise something that does not exist.
    expect(menu.replies[0]).toBe(
      'Dr. Arjun Rao\n\nHow can we help you today?\n[Book appointment] [My appointment] [Cancel it]',
    );

    const dates = await say('1');
    expect(dates.step).toBe('SLOT_AWAITING_DATE');
    expect(dates.replies[0]).toBe(
      'Which day would you like to come in?\n[Mon, 21 Sep] [Tue, 22 Sep] [Wed, 23 Sep]',
    );

    const times = await say('1');
    expect(times.step).toBe('SLOT_AWAITING_TIME');

    const confirm = await say('1');
    expect(confirm.step).toBe('SLOT_CONFIRM_BOOKING');
    expect(confirm.replies[0]).toBe(
      'Confirm your appointment?\n\nDr. Arjun Rao\n*Mon, 21 Sep at 09:15 AM*\n[Yes, confirm] [No, go back]',
    );

    const booked = await say('1');
    expect(booked.replies[0]).toContain('Your appointment is confirmed.');
    expect(booked.replies[0]).toContain('*Mon, 21 Sep at 09:15 AM*');
    expect(world.appointments).toHaveLength(1);
    expect(world.appointments[0]!.type).toBe('SLOT');
  });

  /** Three days, not fourteen. Nobody plans a GP visit a fortnight out. */
  it('offers three days and no more', async () => {
    await arrive();
    await say('1');

    expect(optionsOf().map((o) => o.title)).toEqual(['Mon, 21 Sep', 'Tue, 22 Sep', 'Wed, 23 Sep']);
  });

  /**
   * One screen, not two.
   *
   * Morning/afternoon used to be a separate question before the times, so an
   * evening slot cost two taps. The single list now spreads across the day, so
   * an evening time is visible without asking for it.
   */
  it('shows morning, afternoon and evening times together on the first screen', async () => {
    await arrive();
    await say('1');
    await say('1');

    const times = optionsOf().map((o) => o.title);

    expect(times.filter((t) => t.includes('AM')).length).toBeGreaterThan(0);
    expect(times.filter((t) => t.startsWith('03')).length).toBeGreaterThan(0);
    expect(times.filter((t) => t.startsWith('05')).length).toBeGreaterThan(0);
  });

  it('never hands back the screen that was tapped', async () => {
    // The menu, then the date list, then the time list.
    for (const depth of [0, 1, 2]) {
      await tapEveryOption(async () => {
        setUp();
        await arrive();
        for (let i = 0; i <= depth; i += 1) await say('1');
      });
    }
  });

  it('does not offer a time somebody already holds', async () => {
    await bookFirst();

    await say('1');
    await say('1');

    expect(optionsOf().map((o) => o.title)).not.toContain('09:15 AM');
  });

  /**
   * Reported by the clinic: "Why are we giving an option to cancel after
   * booking it?" Asking for a second time on a day they already have must
   * offer the move, not a dead end with instructions.
   */
  it('offers to move the appointment rather than making them cancel it', async () => {
    await bookFirst();

    await say('1'); // Book appointment
    await say('1'); // same day
    await say('2'); // a different time
    const clash = await say('1'); // Yes, confirm

    expect(clash.step).toBe('SLOT_CONFIRM_MOVE');
    expect(clash.replies[0]).toContain('Move it');
    expect(clash.replies[0]).not.toContain('cancel it first');
  });

  it('holds the new time before releasing the old one', async () => {
    await bookFirst();
    const original = world.appointments[0]!.slotStart;

    await say('1');
    await say('1');
    await say('2');
    await say('1');
    const moved = await say('1'); // Yes, move it

    expect(moved.replies[0]).toContain('Your appointment has been moved.');

    const live = world.appointments.filter((a) => a.status === 'BOOKED');
    expect(live).toHaveLength(1);
    expect(live[0]!.slotStart).not.toEqual(original);
    expect(world.appointments.filter((a) => a.status === 'CANCELLED')).toHaveLength(1);
  });

  /**
   * Reported as a bug: a 9am appointment booked at 9am promised a reminder
   * "the evening before", which was yesterday.
   */
  it('promises no reminder it cannot send', async () => {
    await arrive();
    await say('1');
    await say('1'); // today
    await say('1'); // 15 minutes from now

    const booked = await say('1');

    expect(booked.replies[0]).not.toContain('the evening before');
    expect(booked.replies[0]).not.toContain('1 hour before');
    expect(booked.replies[0]).toContain('Reply *cancel* if you cannot make it.');
  });

  it('promises both reminders for a day that has not happened yet', async () => {
    await arrive();
    await say('1');
    await say('2'); // tomorrow
    await say('1');

    const booked = await say('1');

    expect(booked.replies[0]).toContain(
      'We will remind you the evening before and again 1 hour ahead.',
    );
  });

  it('cancels with buttons that say what they do', async () => {
    await bookFirst();

    const asked = await say('cancel');
    expect(asked.step).toBe('SLOT_CONFIRM_CANCEL');
    expect(asked.replies[0]).toBe(
      'Cancel your appointment on Mon, 21 Sep at 09:15 AM?\n[Yes, cancel it] [No, keep it]',
    );

    await say('1');
    expect(world.appointments[0]!.status).toBe('CANCELLED');
    expect(world.effects).toContain('CANCEL_REMINDERS');
  });

  it('keeps the appointment when the patient backs out', async () => {
    await bookFirst();
    await say('cancel');

    const kept = await say('2');

    expect(kept.replies[0]).toContain('kept');
    expect(world.appointments[0]!.status).toBe('BOOKED');
  });

  /**
   * The clash rule is per DAY, so a patient may hold one on Monday and another
   * on Tuesday. The bot used to ask for that with a findFirst and therefore
   * showed only the earliest — the Tuesday one existed, was invisible, and
   * could not be cancelled, because cancelling acted on the Monday one.
   */
  describe('holding more than one appointment', () => {
    const bookSecondDay = async () => {
      await say('1'); // Book appointment
      await say('2'); // Tue, the next day
      await say('1'); // first free time
      await say('1'); // Yes, confirm
    };

    it('lets them book a second one on a different day', async () => {
      await bookFirst();
      await bookSecondDay();

      expect(world.appointments.filter((a) => a.status === 'BOOKED')).toHaveLength(2);
    });

    it('names every appointment they hold, not just the next one', async () => {
      await bookFirst();
      await bookSecondDay();

      const status = await say('2'); // My appointment

      expect(status.replies[0]).toContain('Mon, 21 Sep');
      expect(status.replies[0]).toContain('Tue, 22 Sep');
    });

    it('asks which one to cancel', async () => {
      await bookFirst();
      await bookSecondDay();

      const asked = await say('cancel');

      expect(asked.step).toBe('SLOT_AWAITING_CANCEL_CHOICE');
      expect(asked.replies[0]).toContain('Which appointment would you like to cancel?');
      expect(optionsOf().map((o) => o.title)).toEqual([
        'Mon, 21 Sep · 09:15 AM',
        'Tue, 22 Sep · 09:00 AM',
      ]);
    });

    /** The bug, stated as a test: cancelling the later one must spare the earlier. */
    it('cancels the one they picked, not the soonest', async () => {
      await bookFirst();
      await bookSecondDay();
      const monday = world.appointments.find((a) => a.date.getUTCDate() === 21)!;
      const tuesday = world.appointments.find((a) => a.date.getUTCDate() === 22)!;

      await say('cancel');
      const confirm = await say('2'); // the Tuesday one
      expect(confirm.step).toBe('SLOT_CONFIRM_CANCEL');
      expect(confirm.replies[0]).toContain('Tue, 22 Sep');

      await say('1'); // Yes, cancel it

      expect(tuesday.status).toBe('CANCELLED');
      expect(monday.status).toBe('BOOKED');
    });

    it('re-asks rather than guessing when the choice makes no sense', async () => {
      await bookFirst();
      await bookSecondDay();
      await say('cancel');

      const again = await say('9');

      expect(again.step).toBe('SLOT_AWAITING_CANCEL_CHOICE');
      expect(world.appointments.filter((a) => a.status === 'BOOKED')).toHaveLength(2);
    });

    /** One appointment must still go straight to the confirmation. */
    it('does not ask which when there is only one', async () => {
      await bookFirst();

      const asked = await say('cancel');

      expect(asked.step).toBe('SLOT_CONFIRM_CANCEL');
    });
  });

  it('shows the appointment they hold', async () => {
    await bookFirst();

    const status = await say('2');

    expect(status.replies[0]).toContain('Your appointment:');
    expect(status.replies[0]).toContain('*Mon, 21 Sep at 09:15 AM*');
  });

  it('offers no doctor switch, having nobody to switch to', async () => {
    await arrive();

    const menu = await say('menu');

    expect(menu.replies[0]).not.toContain('Change doctor');
    expect((await say('doctor')).step).not.toBe('SELECT_DOCTOR');
  });
});
