import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * JOURNEY 4 — ANSWERING A FOLLOW-UP REMINDER
 *
 * "Review in 2 weeks." Two weeks later the patient gets a WhatsApp reminder
 * with a Book button, taps it, and is booking.
 *
 * Cuts across the other three journeys rather than being another clinic shape,
 * because the promise is the same everywhere and only the last step differs: a
 * token clinic offers today's queue, a slot clinic offers days.
 *
 * What makes it one tap is that the button names the visit it follows up. A
 * plain "book" from a patient at a three-doctor practice is a question — which
 * doctor? — and the wrong answer books them with someone they have never seen.
 * The payload settles it before the bot opens its mouth.
 */

vi.mock('../../db/prisma', async () => (await import('./world')).prismaModule());
vi.mock('../../domain/clinics', async () => (await import('./world')).clinicsModule());
vi.mock('../../domain/patients', async () => (await import('./world')).patientsModule());
vi.mock('../../queue/queues', async () => (await import('./world')).queuesModule());
vi.mock('../../domain/slots', async () => (await import('./world')).slotsModule());
vi.mock('../../domain/tokenQueue', async () => (await import('./world')).tokenQueueModule());
vi.mock('../../domain/appointments', async () => (await import('./world')).appointmentsModule());
vi.mock('../../domain/followUp', async () => (await import('./world')).followUpModule());
vi.mock('../../utils/logger', async () => (await import('./world')).loggerModule());

import { followUpPayload } from '../../domain/followUp';
import { resetTranscript, say } from './drive';
import { resetWorld, world, type WorldConfig } from './world';

const THREE: WorldConfig['doctors'] = [
  { name: 'Arjun Rao', mode: 'SLOT' },
  { name: 'Kavya Shetty', mode: 'SLOT' },
  { name: 'Meera Nair', mode: 'SLOT' },
];

const arrive = async () => {
  await say('hi');
  await say('1'); // English
  await say('Asha Rao');
};

/** The visit that ended with "come back in two weeks", with Dr Kavya. */
function pastVisitWith(doctorIndex: number) {
  const patient = world.patients[0]!;
  const appointment = {
    id: 'appt-past',
    doctorId: world.doctors[doctorIndex]!.id,
    patientId: patient.id,
    date: new Date('2026-09-07T00:00:00Z'),
    type: 'SLOT',
    status: 'DONE',
    slotStart: new Date('2026-09-07T04:00:00Z'),
    tokenNumber: null,
    cancelledAt: null,
    followUpOn: new Date('2026-09-21T00:00:00Z'),
    followUpSentAt: new Date('2026-09-21T03:00:00Z'),
    followUpTappedAt: null,
  } as unknown as (typeof world.appointments)[number];
  world.appointments.push(appointment);
  return appointment;
}

beforeEach(() => {
  resetWorld({ clinicName: 'Lakeview Clinic', doctors: THREE });
  resetTranscript();
});

describe('answering a follow-up reminder', () => {
  it('opens booking with the doctor who asked them back, without asking', async () => {
    await arrive();
    await say('1'); // they happen to have chosen Dr Arjun before
    const visit = pastVisitWith(1); // but the follow-up is Dr Kavya's

    const tapped = await say(followUpPayload(visit.id));

    expect(tapped.step).toBe('SLOT_AWAITING_DATE');
    // Names Kavya, not the Arjun they picked a moment ago: the tap settled it.
    expect(tapped.replies[0]).toContain('Dr. Kavya Shetty — which day would you like to come in?');
    // Never asked. That is the feature.
    expect(tapped.replies.join()).not.toContain('Which doctor');
  });

  /** The conversion funnel has to be able to see the tap that happened. */
  it('records the tap, once, however many times they press it', async () => {
    await arrive();
    await say('1');
    const visit = pastVisitWith(1);

    await say(followUpPayload(visit.id));
    const first = visit.followUpTappedAt;
    await say(followUpPayload(visit.id));

    expect(first).toBeInstanceOf(Date);
    expect(visit.followUpTappedAt).toEqual(first);
  });

  it('books with that doctor, not the one they last spoke to', async () => {
    await arrive();
    await say('1'); // Dr Arjun
    const visit = pastVisitWith(1); // Dr Kavya's follow-up

    await say(followUpPayload(visit.id));
    await say('1'); // a day
    await say('1'); // a time
    await say('1'); // yes

    const booked = world.appointments.find((a) => a.status === 'BOOKED');
    expect(booked?.doctorId).toBe(world.doctors[1]!.id);
  });

  /** A reminder can arrive weeks after the last conversation ended anywhere. */
  it('works from a cold start, with no conversation in progress', async () => {
    await arrive();
    const visit = pastVisitWith(2);
    world.sessions.clear();

    const tapped = await say(followUpPayload(visit.id));

    expect(tapped.step).toBe('SLOT_AWAITING_DATE');
  });

  it('abandons a half-finished conversation rather than resuming it', async () => {
    await arrive();
    await say('1');
    await say('1'); // part-way into picking a date
    const visit = pastVisitWith(0);

    const tapped = await say(followUpPayload(visit.id));

    expect(tapped.step).toBe('SLOT_AWAITING_DATE');
    expect(tapped.replies[0]).toContain('Dr. Arjun Rao — which day');
  });

  /**
   * The payload reaches us as inbound text, and a patient can type anything.
   * Another patient's appointment id must tell them nothing and change
   * nothing — it is handled as if they had typed any other unknown words.
   */
  it('ignores an appointment that is not theirs', async () => {
    await arrive();
    await say('1');
    const visit = pastVisitWith(1);
    visit.patientId = 'somebody-else';

    const tapped = await say(followUpPayload(visit.id));

    expect(tapped.step).not.toBe('SLOT_AWAITING_DATE');
    expect(tapped.replies.join()).not.toContain('Kavya');
  });

  it('ignores an appointment id that does not exist', async () => {
    await arrive();
    await say('1');

    const tapped = await say(followUpPayload('made-up-id'));

    expect(tapped.replies[0]).toBeDefined();
    expect(tapped.step).not.toBe('SLOT_AWAITING_DATE');
  });

  /** A doctor who has left cannot be booked, tap or no tap. */
  it('falls back to the picker when that doctor is no longer bookable', async () => {
    await arrive();
    const visit = pastVisitWith(1);
    world.doctors[1]!.status = 'INACTIVE' as (typeof world.doctors)[number]['status'];
    world.sessions.clear();

    const tapped = await say(followUpPayload(visit.id));

    expect(tapped.step).not.toBe('SLOT_AWAITING_DATE');
  });

  it('takes a token-mode patient straight to the token confirmation', async () => {
    resetWorld({
      clinicName: 'Sunrise Clinic',
      doctors: [{ name: 'Ramesh Kumar', mode: 'TOKEN' }],
    });
    await arrive();
    const visit = pastVisitWith(0);

    const tapped = await say(followUpPayload(visit.id));

    expect(tapped.step).toBe('TOKEN_CONFIRM_BOOKING');
    expect(tapped.replies[0]).toContain('Book a token with Dr. Ramesh Kumar');
  });
});
