import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The shared-number path, end to end through the REAL resolver.
 *
 * sharedNumberRouting.test.ts proves the decision table in isolation. This
 * proves the wiring: that resolveClinicForChannel actually reaches it, queries
 * the right things, and — the part that matters most — that a clinic with its
 * own WhatsApp number never touches any of it.
 *
 * Only the database is mocked. findClinic, findClinicOnSharedNumber and
 * resolveSharedNumberClinic are the real ones, because the wiring is exactly
 * what a unit test of the decision table cannot check.
 */

const clinicFindUnique = vi.fn();
const clinicFindFirst = vi.fn();
const clinicCount = vi.fn();
const doctorFindUnique = vi.fn();
const doctorFindMany = vi.fn();
const sessionFindFirst = vi.fn();
const patientFindUnique = vi.fn();
const appointmentFindMany = vi.fn();

vi.mock('../db/prisma', () => ({
  prisma: {
    clinic: {
      findUnique: (...a: unknown[]) => clinicFindUnique(...a),
      findFirst: (...a: unknown[]) => clinicFindFirst(...a),
      count: (...a: unknown[]) => clinicCount(...a),
    },
    doctor: {
      findUnique: (...a: unknown[]) => doctorFindUnique(...a),
      findMany: (...a: unknown[]) => doctorFindMany(...a),
      count: vi.fn(),
    },
    conversationSession: { findFirst: (...a: unknown[]) => sessionFindFirst(...a) },
    patient: { findUnique: (...a: unknown[]) => patientFindUnique(...a) },
    appointment: { findMany: (...a: unknown[]) => appointmentFindMany(...a) },
  },
}));

const { env } = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock('../config/env', () => ({ env }));
vi.mock('../utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { outboundChannelForClinic, resolveClinicForChannel } from './clinics';

const PLATFORM = 'pn-platform';
const DENTIN = { id: 'dentin', name: 'ClinicForYou Demo', whatsappPhoneNumberId: 'pn-dentin', code: null };
const SHARED_A = { id: 'shared-a', name: 'Koramangala Family Clinic', whatsappPhoneNumberId: null, code: 'C-AAAAA' };
const SHARED_B = { id: 'shared-b', name: 'Indiranagar Skin Clinic', whatsappPhoneNumberId: null, code: 'C-BBBBB' };
const ALL = [DENTIN, SHARED_A, SHARED_B];

/** Dispatches on the where-clause, the way Prisma's real findUnique does. */
const clinicLookup = ({ where }: { where: Record<string, unknown> }) => {
  if (where['id']) return ALL.find((c) => c.id === where['id']) ?? null;
  if (where['code']) return ALL.find((c) => c.code === where['code']) ?? null;
  if (where['whatsappPhoneNumberId']) {
    return ALL.find((c) => c.whatsappPhoneNumberId === where['whatsappPhoneNumberId']) ?? null;
  }
  return null;
};

const inbound = (text: string, phone = '919000000001') => ({ text, phone });

beforeEach(() => {
  env['PLATFORM_PHONE_NUMBER_ID'] = PLATFORM;
  env['MESSAGING_PROVIDER'] = 'whatsapp_cloud';
  env['DEFAULT_DOCTOR_ID'] = undefined;

  clinicFindUnique.mockReset().mockImplementation(clinicLookup);
  clinicFindFirst.mockReset().mockResolvedValue(null);
  clinicCount.mockReset().mockResolvedValue(3);
  doctorFindUnique.mockReset().mockResolvedValue(null);
  // Every clinic has a bookable doctor, else resolveClinicForChannel refuses.
  doctorFindMany.mockReset().mockResolvedValue([{ id: 'doc-1', status: 'ACTIVE' }]);
  sessionFindFirst.mockReset().mockResolvedValue(null);
  patientFindUnique.mockReset().mockResolvedValue(null);
  appointmentFindMany.mockReset().mockResolvedValue([]);
});

/**
 * The guarantee that matters most. Dentin and Jalaja are live, and this change
 * must be invisible to them.
 */
describe('a clinic with its own WhatsApp number', () => {
  it('still resolves by phone_number_id, exactly as before', async () => {
    const out = await resolveClinicForChannel('pn-dentin', inbound('hi'));

    expect(out?.clinic.id).toBe('dentin');
  });

  it('never consults the shared-number path, even if the text contains a code', async () => {
    const out = await resolveClinicForChannel('pn-dentin', inbound('Book an appointment C-AAAAA'));

    // A code belonging to another clinic must not drag a patient off Dentin.
    expect(out?.clinic.id).toBe('dentin');
    expect(sessionFindFirst).not.toHaveBeenCalled();
    expect(appointmentFindMany).not.toHaveBeenCalled();
  });

  it('still refuses an unknown number rather than guessing', async () => {
    expect(await resolveClinicForChannel('pn-nobody', inbound('hi'))).toBeNull();
  });

  /** With no platform number configured the new path cannot be reached at all. */
  it('is unaffected when no platform number is configured', async () => {
    env['PLATFORM_PHONE_NUMBER_ID'] = undefined;

    expect((await resolveClinicForChannel('pn-dentin', inbound('hi')))?.clinic.id).toBe('dentin');
    expect(await resolveClinicForChannel(PLATFORM, inbound('Book C-AAAAA'))).toBeNull();
  });
});

describe('a clinic on the shared platform number', () => {
  it('routes by the code in the deeplink', async () => {
    const out = await resolveClinicForChannel(PLATFORM, inbound('Book an appointment C-AAAAA'));

    expect(out?.clinic.id).toBe('shared-a');
  });

  it('sends a different code to a different clinic', async () => {
    const out = await resolveClinicForChannel(PLATFORM, inbound('Book an appointment C-BBBBB'));

    expect(out?.clinic.id).toBe('shared-b');
  });

  it('carries the clinic through later messages that have no code', async () => {
    sessionFindFirst.mockResolvedValue({ clinicId: 'shared-a' });

    const out = await resolveClinicForChannel(PLATFORM, inbound('1'));

    expect(out?.clinic.id).toBe('shared-a');
  });

  /** Scanning another clinic's QR mid-conversation means that clinic. */
  it('lets a fresh code override the live session', async () => {
    sessionFindFirst.mockResolvedValue({ clinicId: 'shared-a' });

    const out = await resolveClinicForChannel(PLATFORM, inbound('Book an appointment C-BBBBB'));

    expect(out?.clinic.id).toBe('shared-b');
  });

  it('recognises a returning patient who has used exactly one clinic', async () => {
    patientFindUnique.mockResolvedValue({ id: 'pat-1' });
    appointmentFindMany.mockResolvedValue([{ doctor: { clinicId: 'shared-b' } }]);

    const out = await resolveClinicForChannel(PLATFORM, inbound('hi'));

    expect(out?.clinic.id).toBe('shared-b');
  });

  /**
   * Two clinics and nothing to choose between them: refuse rather than guess.
   * Handing a patient to the wrong practice is the failure this whole module
   * exists to avoid, and a coin toss is not an answer.
   */
  it('refuses when the patient has used several clinics and sent no code', async () => {
    patientFindUnique.mockResolvedValue({ id: 'pat-1' });
    appointmentFindMany.mockResolvedValue([
      { doctor: { clinicId: 'shared-a' } },
      { doctor: { clinicId: 'shared-b' } },
    ]);

    expect(await resolveClinicForChannel(PLATFORM, inbound('hi'))).toBeNull();
  });

  it('refuses a stranger with no code', async () => {
    expect(await resolveClinicForChannel(PLATFORM, inbound('hello'))).toBeNull();
  });

  /** A stale card must not dead-end a patient who has been here before. */
  it('falls back to history when the code matches no clinic', async () => {
    patientFindUnique.mockResolvedValue({ id: 'pat-1' });
    appointmentFindMany.mockResolvedValue([{ doctor: { clinicId: 'shared-a' } }]);

    const out = await resolveClinicForChannel(PLATFORM, inbound('Book an appointment C-ZZZZZ'));

    expect(out?.clinic.id).toBe('shared-a');
  });

  it('still refuses a clinic whose doctors are all disabled', async () => {
    doctorFindMany.mockResolvedValue([]);

    expect(await resolveClinicForChannel(PLATFORM, inbound('Book an appointment C-AAAAA'))).toBeNull();
  });
});

/**
 * Routing a patient in is only half of it. A clinic with no number of its own
 * has no sender either, and the fallback underneath is the global default — in
 * the live deployment a +1 555 test number, which would answer a Bangalore
 * patient from a US test line. Inbound tests cannot see this, so it is pinned
 * here next to them.
 */
describe('which number a shared-number clinic answers from', () => {
  const asClinic = (c: { whatsappPhoneNumberId: string | null }) =>
    c as Parameters<typeof outboundChannelForClinic>[0];

  it('answers from the platform number', () => {
    expect(outboundChannelForClinic(asClinic(SHARED_A))).toBe(PLATFORM);
  });

  it('still answers from its own number when it has one', () => {
    expect(outboundChannelForClinic(asClinic(DENTIN))).toBe('pn-dentin');
  });

  /** No platform number configured: unchanged, so the adapter default applies. */
  it('falls back to the adapter default only when there is no platform number', () => {
    env['PLATFORM_PHONE_NUMBER_ID'] = undefined;

    expect(outboundChannelForClinic(asClinic(SHARED_A))).toBeUndefined();
    expect(outboundChannelForClinic(asClinic(DENTIN))).toBe('pn-dentin');
  });
});
