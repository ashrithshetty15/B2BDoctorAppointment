import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * JOURNEY 3 OF 3 — A CLINIC WITH SEVERAL DOCTORS
 *
 * One WhatsApp number for the practice, and the bot asks which doctor. This is
 * what makes a hundred clinics fit inside a WABA's twenty numbers, and it is
 * the only shape where the doctor is a thing the patient chooses, changes, and
 * can get stuck on.
 *
 * Both reported bugs in this shape were about the choice sticking: picking
 * Arjun once meant every later turn silently belonged to Arjun, with no way
 * back short of waiting two hours for the session to expire.
 *
 * Sibling journeys: soloToken.journey.test.ts, soloSlot.journey.test.ts.
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
import { resetWorld, world, type WorldConfig } from './world';

const THREE: WorldConfig['doctors'] = [
  { name: 'Arjun Rao', mode: 'SLOT' },
  { name: 'Kavya Shetty', mode: 'SLOT' },
  { name: 'Meera Nair', mode: 'SLOT' },
];

const setUp = (doctors: WorldConfig['doctors'] = THREE) =>
  resetWorld({ clinicName: 'Lakeview Clinic', doctors });

const arrive = async () => {
  await say('hi');
  await say('1'); // English
  await say('Asha Rao');
};

beforeEach(() => {
  setUp();
  resetTranscript();
});

describe('a clinic with several doctors', () => {
  it('asks which doctor, then books with the one chosen', async () => {
    await say('hi');
    await say('1');

    const picker = await say('Asha Rao');
    expect(picker.step).toBe('SELECT_DOCTOR');
    expect(picker.replies[0]).toBe(
      'Which doctor would you like to see?\n[Dr. Arjun Rao] [Dr. Kavya Shetty] [Dr. Meera Nair]',
    );

    const menu = await say('2');
    expect(menu.step).toBe('SLOT_MENU');
    expect(menu.replies[0]).toContain('Dr. Kavya Shetty');
    // The third button becomes the way back out, which a solo clinic has no
    // use for.
    expect(menu.replies[0]).toContain('[Change doctor]');
    expect(menu.replies[0]).toContain('_Reply *cancel* to cancel your appointment._');

    await say('1');
    await say('1');
    await say('1');
    await say('1');

    expect(world.appointments).toHaveLength(1);
    expect(world.appointments[0]!.doctorId).toBe(world.doctors[1]!.id);
  });

  /**
   * The reported bug, in the clinic's words: "Lakeview has 3 doctors but once
   * you select Arjun, it always selects Arjun, other doctor options are not
   * visible."
   */
  it('lets the patient change doctor at any point', async () => {
    await arrive();
    await say('1'); // Dr. Arjun Rao

    const reopened = await say('doctor');
    expect(reopened.step).toBe('SELECT_DOCTOR');
    expect(optionsOf().map((o) => o.title)).toEqual([
      'Dr. Arjun Rao',
      'Dr. Kavya Shetty',
      'Dr. Meera Nair',
    ]);

    const switched = await say('3');
    expect(switched.replies[0]).toContain('Dr. Meera Nair');
    expect(String(world.sessions.get('919000000001')?.['doctorId'])).toBe(world.doctors[2]!.id);
  });

  /**
   * The half of that bug that lived in the engine: re-opening the picker has
   * to FORGET the current doctor. Remembering them made the next turn honour
   * the old choice and discard the answer — the picker appeared, the tap did
   * nothing.
   */
  it('honours the answer to the picker rather than the previous choice', async () => {
    await arrive();
    await say('1'); // Arjun
    await say('doctor');
    await say('2'); // Kavya

    const menu = await say('menu');

    expect(menu.replies[0]).toContain('Dr. Kavya Shetty');
    expect(menu.replies[0]).not.toContain('Dr. Arjun Rao');
  });

  it('can switch again, and again', async () => {
    await arrive();
    await say('1');

    for (const [choice, name] of [
      ['2', 'Dr. Kavya Shetty'],
      ['3', 'Dr. Meera Nair'],
      ['1', 'Dr. Arjun Rao'],
    ]) {
      await say('doctor');
      expect((await say(choice!)).replies[0]).toContain(name!);
    }
  });

  it('never hands back the screen that was tapped', async () => {
    // The picker itself, then the menu behind it.
    for (const depth of [0, 1]) {
      await tapEveryOption(async () => {
        setUp();
        await arrive();
        for (let i = 0; i < depth; i += 1) await say('1');
      });
    }
  });

  it('keeps each doctor a separate queue', async () => {
    await arrive();
    await say('1'); // Arjun
    await say('1');
    await say('1');
    await say('1');
    await say('1'); // booked with Arjun

    await say('doctor');
    await say('2'); // Kavya
    await say('1');
    await say('1');
    await say('1');
    const second = await say('1');

    // Same patient, same day, different doctor: a real appointment, not a
    // clash with the one they hold with Arjun.
    expect(second.replies[0]).toContain('Your appointment is confirmed.');
    expect(world.appointments).toHaveLength(2);
    expect(new Set(world.appointments.map((a) => a.doctorId)).size).toBe(2);
  });

  /** Five doctors is the cap, and five still fits in one list. */
  it('offers all five when a clinic is full', async () => {
    setUp([
      ...THREE,
      { name: 'Nikhil Shah', mode: 'SLOT' },
      { name: 'Priya Menon', mode: 'SLOT' },
    ]);
    await arrive();

    expect(optionsOf()).toHaveLength(5);
  });

  it('asks again when the doctor they chose stops being bookable', async () => {
    await arrive();
    await say('1'); // Arjun

    world.doctors[0]!.status = 'INACTIVE' as typeof world.doctors[0]['status'];

    expect((await say('menu')).step).toBe('SELECT_DOCTOR');
  });

  /**
   * A mixed practice is legal — one doctor runs a token queue while another
   * books times — and the mode has to follow the doctor, not the clinic.
   */
  it('follows each doctor into their own booking mode', async () => {
    setUp([
      { name: 'Arjun Rao', mode: 'SLOT' },
      { name: 'Ramesh Kumar', mode: 'TOKEN' },
    ]);
    await arrive();

    expect((await say('1')).step).toBe('SLOT_MENU');

    await say('doctor');

    expect((await say('2')).step).toBe('TOKEN_MENU');
  });
});
