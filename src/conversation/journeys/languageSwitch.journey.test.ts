import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * JOURNEY — GETTING BACK OUT OF A LANGUAGE YOU CANNOT READ
 *
 * Reported by the clinic: "once a user selects a language he is not able to
 * change it. Suppose a user selects Kannada he is not able to change it."
 *
 * The switch existed, but answered only to six Latin-script words. A patient
 * who chose Kannada — because they read Kannada — would type ಭಾಷೆ, the exact
 * word this app's own prompt teaches them ("ನಿಮ್ಮ ಭಾಷೆ ಆಯ್ಕೆ ಮಾಡಿ"), and be
 * told "ಕ್ಷಮಿಸಿ, ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ". The one escape hatch answered only to the
 * words the trapped patient was least likely to type.
 *
 * Driven through the real engine, because the unit test proves only that a
 * string matches — not that the menu reopens mid-booking, that the choice
 * sticks, or that the conversation survives it.
 */

vi.mock('../../db/prisma', async () => (await import('./world')).prismaModule());
vi.mock('../../domain/clinics', async () => (await import('./world')).clinicsModule());
vi.mock('../../domain/patients', async () => (await import('./world')).patientsModule());
vi.mock('../../queue/queues', async () => (await import('./world')).queuesModule());
vi.mock('../../domain/slots', async () => (await import('./world')).slotsModule());
vi.mock('../../domain/tokenQueue', async () => (await import('./world')).tokenQueueModule());
vi.mock('../../domain/appointments', async () => (await import('./world')).appointmentsModule());
vi.mock('../../utils/logger', async () => (await import('./world')).loggerModule());

import { resetTranscript, say } from './drive';
import { resetWorld, world } from './world';

const setUp = () =>
  resetWorld({
    clinicName: 'Lakeview Clinic',
    doctors: [{ name: 'Arjun Rao', mode: 'SLOT' }],
  });

/** Arrive and choose Kannada — the state the report starts from. */
const arriveInKannada = async () => {
  await say('hi');
  await say('2'); // ಕನ್ನಡ
  await say('Asha Rao');
};

const hasKannada = (s: string) => /[ಀ-೿]/.test(s);

/** Template names emitted since a mark, read off what was actually sent. */
const sentSince = (mark: number) => world.sent.slice(mark).map((m) => m.templateName);
const mark = () => world.sent.length;

beforeEach(() => {
  setUp();
  resetTranscript();
});

describe('a patient who chose Kannada', () => {
  /**
   * Guards the premise. If the bot were answering in English anyway, every
   * other test here would pass for the wrong reason.
   */
  it('is actually being answered in Kannada to begin with', async () => {
    // Not asserted on the opening prompt: that one offers "[English] [ಕನ್ನಡ]"
    // as buttons, so it contains Kannada whichever language you end up in.
    await say('hi');
    await say('2'); // ಕನ್ನಡ

    const named = await say('Asha Rao');

    expect(named.replies.some(hasKannada)).toBe(true);
  });

  it('reopens the language menu when they type ಭಾಷೆ', async () => {
    await arriveInKannada();
    const m = mark();

    await say('ಭಾಷೆ');

    expect(sentSince(m)).toContain('languagePrompt');
  });

  /** The word they were most likely to try: the button they originally tapped. */
  it('also answers to ಕನ್ನಡ', async () => {
    await arriveInKannada();
    const m = mark();

    await say('ಕನ್ನಡ');

    expect(sentSince(m)).toContain('languagePrompt');
  });

  it('offers both languages to tap, so no typing is needed the second time', async () => {
    await arriveInKannada();

    const frame = await say('ಭಾಷೆ');

    expect(frame.replies.join(' ')).toContain('English');
    expect(frame.replies.join(' ')).toContain('ಕನ್ನಡ');
  });

  it('gets back to English and stays there', async () => {
    await arriveInKannada();

    await say('ಭಾಷೆ');
    await say('1'); // English

    const frame = await say('hi');
    expect(frame.replies.some(hasKannada)).toBe(false);
    expect(world.patients[0]?.language).toBe('EN');
  });
});

describe('changing language part-way through a booking', () => {
  it('does not require abandoning what they were doing', async () => {
    await arriveInKannada();
    await say('1'); // start booking
    await say('1'); // a day
    const m = mark();

    await say('ಭಾಷೆ');

    expect(sentSince(m)).toContain('languagePrompt');
  });

  it('can still finish a booking afterwards, in the new language', async () => {
    await arriveInKannada();
    await say('1'); // start booking
    await say('ಭಾಷೆ');
    await say('1'); // English

    await say('1'); // Book appointment
    await say('1'); // day
    await say('1'); // time
    const frame = await say('1'); // confirm

    expect(world.appointments).toHaveLength(1);
    expect(frame.replies.some(hasKannada)).toBe(false);
  });
});

/**
 * The check runs ahead of every step, so a word that collides with ordinary
 * input would hijack a booking mid-flow.
 */
describe('the switch stays narrow', () => {
  it('does not swallow an ordinary menu choice', async () => {
    await arriveInKannada();
    await say('1'); // start booking
    const m = mark();

    await say('1'); // picking a day, not asking for the language menu

    expect(sentSince(m)).not.toContain('languagePrompt');
  });

  it('does not fire on a sentence that merely mentions the word', async () => {
    await arriveInKannada();
    const m = mark();

    await say('ನನ್ನ ಭಾಷೆ ಕನ್ನಡ ಆಗಿದೆ'); // "my language is Kannada", a statement

    expect(sentSince(m)).not.toContain('languagePrompt');
  });
});
