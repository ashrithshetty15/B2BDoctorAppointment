import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * JOURNEY 1 OF 3 — ONE DOCTOR, TOKEN MODE
 *
 * The walk-in clinic: no times, just a numbered queue for today. Sunrise
 * Clinic, and the commonest shape there is.
 *
 * This is the configuration that broke. It has no doctor picker, so it takes a
 * branch of the engine that the multi-doctor clinic never reaches — and that
 * branch reported "the doctor was just chosen" on every single turn, which made
 * the engine blank the patient's text and re-render the menu forever. Every
 * unit test passed throughout.
 *
 * Sibling journeys: soloSlot.journey.test.ts, multiDoctor.journey.test.ts.
 */

vi.mock('../../db/prisma', async () => (await import('./world')).prismaModule());
vi.mock('../../domain/clinics', async () => (await import('./world')).clinicsModule());
vi.mock('../../domain/patients', async () => (await import('./world')).patientsModule());
vi.mock('../../queue/queues', async () => (await import('./world')).queuesModule());
vi.mock('../../domain/slots', async () => (await import('./world')).slotsModule());
vi.mock('../../domain/tokenQueue', async () => (await import('./world')).tokenQueueModule());
vi.mock('../../domain/appointments', async () => (await import('./world')).appointmentsModule());
vi.mock('../../utils/logger', async () => (await import('./world')).loggerModule());

import { resetTranscript, say, tapEveryOption } from './drive';
import { resetWorld, world } from './world';

const arrive = async () => {
  await say('hi');
  await say('1'); // English
  await say('Asha Rao');
};

beforeEach(() => {
  resetWorld({
    clinicName: 'Sunrise Clinic',
    doctors: [{ name: 'Ramesh Kumar', mode: 'TOKEN' }],
  });
  resetTranscript();
});

describe('one doctor, token mode', () => {
  it('books a token, start to finish', async () => {
    expect((await say('hi')).replies).toEqual([
      'Welcome! Please choose your language.\n[English] [ಕನ್ನಡ]',
    ]);

    expect((await say('1')).replies).toEqual([
      'Welcome to Sunrise Clinic. What is your name? (Please type your full name)',
    ]);

    // Straight to the menu: one doctor is nobody to choose between.
    const menu = await say('Asha Rao');
    expect(menu.step).toBe('TOKEN_MENU');
    expect(menu.replies).toEqual([
      'Dr. Ramesh Kumar — Mon, 21 Sep\n\nHow can we help you today?' +
        '\n[Book a token] [My token status] [Cancel my token]',
    ]);

    const confirm = await say('1');
    expect(confirm.step).toBe('TOKEN_CONFIRM_BOOKING');
    expect(confirm.replies).toEqual([
      'Book a token with Dr. Ramesh Kumar for Mon, 21 Sep?\n[Yes, confirm] [No, go back]',
    ]);

    const booked = await say('1');
    expect(booked.replies[0]).toContain('*Token #1*');
    expect(booked.replies[0]).toContain('Patients ahead of you: 0');
    // Never a number the patient has to remember to type.
    expect(booked.replies[0]).toContain('Reply *status* anytime to check yours.');
  });

  /**
   * The bug, stated as the clinic experienced it. Without the fix in
   * selectDoctor this is a menu three times over.
   */
  it('moves forward on every tap instead of repeating the menu', async () => {
    await arrive();

    const first = await say('1');
    const second = await say('1');

    expect(first.step).toBe('TOKEN_CONFIRM_BOOKING');
    expect(second.step).toBe('TOKEN_MENU');
    expect(second.replies[0]).toContain('Your token is confirmed.');
  });

  it('never hands back the screen that was tapped', async () => {
    await tapEveryOption(async () => {
      resetWorld({
        clinicName: 'Sunrise Clinic',
        doctors: [{ name: 'Ramesh Kumar', mode: 'TOKEN' }],
      });
      await arrive();
    });
  });

  it('reports the queue position rather than issuing a second token', async () => {
    await arrive();
    await say('1');
    await say('1');

    const status = await say('2');

    expect(status.replies[0]).toContain('*Token #1*');
    expect(world.appointments.filter((a) => a.status === 'BOOKED')).toHaveLength(1);
  });

  it('cancels with buttons that say what they do', async () => {
    await arrive();
    await say('1');
    await say('1');

    const asked = await say('3');
    expect(asked.replies[0]).toBe(
      'Cancel *token #1* for Mon, 21 Sep?\n[Yes, cancel it] [No, keep it]',
    );

    const done = await say('1');
    expect(done.replies[0]).toContain('has been cancelled');
    expect(world.appointments[0]!.status).toBe('CANCELLED');
  });

  it('keeps the token when the patient backs out', async () => {
    await arrive();
    await say('1');
    await say('1');
    await say('3');

    const kept = await say('2');

    expect(kept.replies[0]).toContain('Nothing was cancelled.');
    expect(world.appointments[0]!.status).toBe('BOOKED');
  });

  it('says so plainly when there is nothing to cancel', async () => {
    await arrive();

    const nothing = await say('3');

    expect(nothing.replies[0]).toBe(
      'You do not have an active token for today. Reply *book* to take one.',
    );
  });

  /** The words the copy now advertises have to be words the bot accepts. */
  it.each([
    ['book', 'TOKEN_CONFIRM_BOOKING'],
    ['cancel', 'TOKEN_MENU'],
    ['status', 'TOKEN_MENU'],
  ])('understands the typed word %s', async (word, step) => {
    await arrive();

    expect((await say(word)).step).toBe(step);
  });

  it('offers no doctor switch, having nobody to switch to', async () => {
    await arrive();
    const menu = await say('menu');

    expect(menu.replies[0]).not.toContain('Change doctor');
    expect((await say('doctor')).step).not.toBe('SELECT_DOCTOR');
  });
});
