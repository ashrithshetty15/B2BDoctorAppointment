import type { Clinic, Doctor } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Engine-level tests for the one thing unit tests on the picker cannot reach:
 * what gets written back to the session.
 *
 * Switching doctor is a two-turn operation. The first turn re-opens the picker;
 * the second reads the answer. If the first turn saves the *old* doctor, the
 * second sees someone already chosen and ignores the answer — the picker
 * appears, the tap does nothing, and it looks exactly like the bug this fixes.
 */

const saveSession = vi.fn();
const loadSession = vi.fn();
const resolveClinicForChannel = vi.fn();
const enqueueOutboundBulk = vi.fn();
const slotHandle = vi.fn();
const sharedNumberPrompt = vi.fn();

vi.mock('./session', () => ({
  loadSession: (...a: unknown[]) => loadSession(...a),
  saveSession: (...a: unknown[]) => saveSession(...a),
}));

vi.mock('../domain/clinics', () => ({
  resolveClinicForChannel: (...a: unknown[]) => resolveClinicForChannel(...a),
  outboundChannelForClinic: () => 'pn-clinic',
  sharedNumberPrompt: (...a: unknown[]) => sharedNumberPrompt(...a),
}));

vi.mock('../domain/patients', () => ({
  findOrCreatePatient: async () => ({ id: 'pat-1', phone: '919000000001', name: 'Asha', language: 'EN' }),
}));

vi.mock('../queue/queues', () => ({
  enqueueOutboundBulk: (...a: unknown[]) => enqueueOutboundBulk(...a),
  cancelReminders: vi.fn(),
  enqueueTokenQueueRecalc: vi.fn(),
}));

// Onboarding already done, so every turn reaches doctor selection.
vi.mock('./flows/onboarding', () => ({
  runOnboarding: async () => ({
    complete: true,
    prefixReplies: [],
    enterFlowFresh: false,
    patch: {},
  }),
}));

// The flows themselves are covered by their own tests; here they only need to
// not touch a database.
vi.mock('./flows/slot', () => ({
  slotFlow: {
    entryStep: 'SLOT_MENU',
    owns: (s: string) => s.startsWith('SLOT_'),
    handle: (...a: unknown[]) => slotHandle(...a),
  },
}));
vi.mock('./flows/token', () => ({
  tokenFlow: { entryStep: 'TOKEN_MENU', owns: () => false, handle: async () => ({ nextStep: 'TOKEN_MENU', replies: [] }) },
}));
vi.mock('./flows/hybrid', () => ({
  hybridFlow: { entryStep: 'HYBRID_AWAITING_MODE', owns: () => false, handle: async () => ({ nextStep: 'HYBRID_AWAITING_MODE', replies: [] }) },
}));

vi.mock('../db/prisma', () => ({
  prisma: {
    processedMessage: { findUnique: async () => null, create: async () => ({}) },
    messagingWindow: { upsert: async () => ({}) },
  },
}));

vi.mock('../utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { handleInboundMessage } from './engine';
import { parseClinicCode } from '../domain/clinicCode';
import { Steps } from './steps';

const clinic = { id: 'c1', name: 'Lakeview Clinic', timezone: 'Asia/Kolkata', defaultLanguage: 'EN' } as unknown as Clinic;

const doc = (id: string, name: string) =>
  ({ id, name, bookingMode: 'SLOT', timezone: 'Asia/Kolkata' }) as unknown as Doctor;

const DOCTORS = [doc('d1', 'Arjun Rao'), doc('d2', 'Kavya Shetty'), doc('d3', 'Meera Nair')];

const inbound = (text: string) => ({
  providerMessageId: `m-${Math.random()}`,
  from: '919000000001',
  channelAddress: 'pn-clinic',
  text,
  receivedAt: new Date('2026-09-18T06:00:00Z'),
  raw: {},
});

const session = (over: Record<string, unknown> = {}) => ({
  step: Steps.SLOT_MENU,
  data: {},
  language: 'EN',
  patientId: 'pat-1',
  doctorId: 'd1',
  wasExpired: false,
  ...over,
});

beforeEach(() => {
  saveSession.mockReset().mockResolvedValue({});
  loadSession.mockReset().mockResolvedValue(session());
  enqueueOutboundBulk.mockReset().mockResolvedValue(undefined);
  resolveClinicForChannel.mockReset().mockResolvedValue({ clinic, doctors: DOCTORS });
  sharedNumberPrompt.mockReset().mockResolvedValue(null);
  slotHandle.mockReset().mockResolvedValue({ nextStep: 'SLOT_MENU', replies: [], data: {} });
});

/**
 * The engine blanks the patient's text when it decides this turn is a *fresh*
 * arrival into the flow — otherwise the answer to a question nobody asked yet
 * would be read as an answer. So "fresh" has to be rare and true.
 *
 * It once was neither. A clinic with one doctor reported "just chosen" on every
 * single turn, which made every turn fresh, which blanked every message, which
 * made the flow re-render its entry step forever: the patient tapped "Book a
 * token" and got the main menu back, endlessly. Every solo clinic — which is
 * most of them — was unusable.
 */
describe('passing the patient input through to the flow', () => {
  const inputSeenByFlow = () => (slotHandle.mock.calls[0]?.[0] as { input: string } | undefined)?.input;

  it('reaches the flow at a single-doctor clinic', async () => {
    resolveClinicForChannel.mockResolvedValue({ clinic, doctors: [DOCTORS[0]] });

    await handleInboundMessage(inbound('1'));

    expect(inputSeenByFlow()).toBe('1');
  });

  it('reaches the flow at a multi-doctor clinic once the doctor is settled', async () => {
    await handleInboundMessage(inbound('1'));

    expect(inputSeenByFlow()).toBe('1');
  });

  /** Fresh is still fresh: the tap that picked the doctor is not a menu answer. */
  it('is withheld on the turn the doctor is chosen', async () => {
    loadSession.mockResolvedValue(
      session({ step: Steps.SELECT_DOCTOR, doctorId: null, data: { doctorIds: ['d1', 'd2', 'd3'] } }),
    );

    await handleInboundMessage(inbound('3'));

    expect(inputSeenByFlow()).toBe('');
  });
});

describe('switching doctor', () => {
  it('re-opens the picker when asked, mid-conversation', async () => {
    await handleInboundMessage(inbound('doctor'));

    expect(saveSession.mock.calls[0]?.[0]?.step).toBe(Steps.SELECT_DOCTOR);
  });

  /**
   * The regression. Saving the old doctor here makes the next turn honour them
   * again, so the answer to the picker is silently discarded.
   */
  it('forgets the previously chosen doctor, so the answer counts', async () => {
    await handleInboundMessage(inbound('doctor'));

    expect(saveSession.mock.calls[0]?.[0]?.doctorId).toBeNull();
  });

  it('records the new doctor on the next turn', async () => {
    loadSession.mockResolvedValue(
      session({ step: Steps.SELECT_DOCTOR, doctorId: null, data: { doctorIds: ['d1', 'd2', 'd3'] } }),
    );

    await handleInboundMessage(inbound('3'));

    expect(saveSession.mock.calls[0]?.[0]?.doctorId).toBe('d3');
  });

  /** Nothing to switch to, so the word is just ordinary input. */
  it('does not open a picker at a single-doctor clinic', async () => {
    resolveClinicForChannel.mockResolvedValue({ clinic, doctors: [DOCTORS[0]] });

    await handleInboundMessage(inbound('doctor'));

    const saved = saveSession.mock.calls[0]?.[0];
    expect(saved?.step).not.toBe(Steps.SELECT_DOCTOR);
    expect(saved?.doctorId).toBe('d1');
  });

  it('keeps the chosen doctor for ordinary input', async () => {
    await handleInboundMessage(inbound('1'));

    expect(saveSession.mock.calls[0]?.[0]?.doctorId).toBe('d1');
    expect(saveSession.mock.calls[0]?.[0]?.step).not.toBe(Steps.SELECT_DOCTOR);
  });

  /** A doctor disabled mid-session must not be silently kept. */
  it('asks again when the remembered doctor is no longer bookable', async () => {
    resolveClinicForChannel.mockResolvedValue({ clinic, doctors: [DOCTORS[1], DOCTORS[2]] });

    await handleInboundMessage(inbound('1'));

    expect(saveSession.mock.calls[0]?.[0]?.step).toBe(Steps.SELECT_DOCTOR);
  });
});

/**
 * On a clinic's own number the chat header names the clinic, so the bot never
 * had to. The shared platform number takes that away: every clinic answers
 * under one name, and a patient who taps a link has no way to tell which
 * practice they just reached.
 */
describe('naming the clinic when a deeplink code chose it', () => {
  it('opens with the clinic name', async () => {
    resolveClinicForChannel.mockResolvedValue({ clinic, doctors: DOCTORS, boundByCode: true });

    const out = await handleInboundMessage(inbound('Book an appointment C-AAAAA'));

    expect(out.replies[0]?.templateName).toBe('clinicIntro');
    expect(out.replies[0]?.text).toContain('Lakeview Clinic');
  });

  /** A clinic with its own number is already named by the thread it arrives in. */
  it('stays quiet when the clinic came from its own phone_number_id', async () => {
    resolveClinicForChannel.mockResolvedValue({ clinic, doctors: DOCTORS, boundByCode: false });

    const out = await handleInboundMessage(inbound('hi'));

    expect(out.replies.map((r) => r.templateName)).not.toContain('clinicIntro');
  });
});

/**
 * A patient who has used several clinics and arrives with no code.
 *
 * The reply they used to get listed the clinic names and then told them to open
 * their clinic's link or scan its QR code -- advice that cannot be acted on from
 * inside the chat, since the link is the thing they do not have. The names are
 * list rows now, and each row's id is the clinic's code, so tapping one sends
 * exactly what the deeplink would have.
 */
describe('asking which clinic, on the shared number', () => {
  const PRIOR = [
    { name: 'Lakeview Clinic', code: 'C-S994X' },
    { name: 'ClinicForYou Demo', code: 'C-EZ2KN' },
  ];

  it('offers the clinics as rows whose ids are their codes', async () => {
    resolveClinicForChannel.mockResolvedValue(null);
    sharedNumberPrompt.mockResolvedValue({ clinics: PRIOR, language: 'EN' });

    const out = await handleInboundMessage(inbound('hi'));

    expect(out.handled).toBe(true);
    const reply = out.replies[0]!;
    expect(reply.templateName).toBe('chooseClinic');
    expect(reply.list?.rows).toEqual([
      { id: 'C-S994X', title: 'Lakeview Clinic' },
      { id: 'C-EZ2KN', title: 'ClinicForYou Demo' },
    ]);
  });

  /** The row id has to survive the round trip as an ordinary inbound code. */
  it('sends a row id the code parser reads back', async () => {
    resolveClinicForChannel.mockResolvedValue(null);
    sharedNumberPrompt.mockResolvedValue({ clinics: PRIOR, language: 'EN' });

    const out = await handleInboundMessage(inbound('hi'));

    for (const row of out.replies[0]!.list!.rows) {
      expect(parseClinicCode(row.id)).toBe(row.id);
    }
  });

  it('enqueues the list rather than text alone', async () => {
    resolveClinicForChannel.mockResolvedValue(null);
    sharedNumberPrompt.mockResolvedValue({ clinics: PRIOR, language: 'EN' });

    await handleInboundMessage(inbound('hi'));

    expect(enqueueOutboundBulk.mock.calls[0]?.[0]?.[0]?.list?.rows).toHaveLength(2);
  });

  /** One prior clinic resolves on its own, so there is nothing to ask. */
  it('asks for a link when there is no history to offer', async () => {
    resolveClinicForChannel.mockResolvedValue(null);
    sharedNumberPrompt.mockResolvedValue({ clinics: [], language: 'EN' });

    const out = await handleInboundMessage(inbound('hi'));

    expect(out.replies[0]?.templateName).toBe('clinicLinkNeeded');
    expect(out.replies[0]?.list).toBeUndefined();
  });
});
