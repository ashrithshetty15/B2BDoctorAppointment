import { beforeEach, describe, expect, it, vi } from 'vitest';

const clinicFindUnique = vi.fn();
const clinicFindFirst = vi.fn();
const clinicCreate = vi.fn();
const clinicUpdate = vi.fn();
const doctorCount = vi.fn();

vi.mock('../db/prisma', () => ({
  prisma: {
    clinic: {
      findUnique: (...a: unknown[]) => clinicFindUnique(...a),
      findFirst: (...a: unknown[]) => clinicFindFirst(...a),
      create: (...a: unknown[]) => clinicCreate(...a),
      update: (...a: unknown[]) => clinicUpdate(...a),
      count: vi.fn(),
    },
    doctor: { count: (...a: unknown[]) => doctorCount(...a), findMany: vi.fn(), findUnique: vi.fn() },
  },
}));

const { env } = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock('../config/env', () => ({ env }));
vi.mock('../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { ClinicFullError, MAX_DOCTORS_PER_CLINIC, clinicForNewDoctor } from './clinics';

const LAKEVIEW = { id: 'c1', name: 'Lakeview Clinic', whatsappPhoneNumberId: 'pn-1' };

beforeEach(() => {
  clinicFindUnique.mockReset().mockResolvedValue(null);
  clinicFindFirst.mockReset().mockResolvedValue(null);
  clinicCreate.mockReset().mockImplementation(({ data }) => ({ id: 'new', ...data }));
  clinicUpdate.mockReset().mockImplementation(({ data }) => ({ ...LAKEVIEW, ...data }));
  doctorCount.mockReset().mockResolvedValue(0);
});

describe('clinicForNewDoctor', () => {
  /**
   * The gap this closes: both create paths set only clinicName, so every doctor
   * added through the console belonged to no clinic and no inbound message
   * could ever reach them.
   */
  it('creates the clinic when this is its first doctor', async () => {
    const c = await clinicForNewDoctor({ clinicName: 'New Practice' });
    expect(clinicCreate).toHaveBeenCalled();
    expect(c.name).toBe('New Practice');
    expect(clinicCreate.mock.calls[0]?.[0]?.data?.apiKey).toMatch(/^ck_[0-9a-f]{32}$/);
  });

  it('joins the existing clinic when the name matches', async () => {
    clinicFindFirst.mockResolvedValueOnce(LAKEVIEW);
    const c = await clinicForNewDoctor({ clinicName: 'Lakeview Clinic' });
    expect(clinicCreate).not.toHaveBeenCalled();
    expect(c.id).toBe('c1');
  });

  /** The number is unique and authoritative; the name is just what was typed. */
  it('matches on the WhatsApp number ahead of the name', async () => {
    clinicFindUnique.mockResolvedValueOnce(LAKEVIEW);
    const c = await clinicForNewDoctor({
      clinicName: 'Typed It Differently',
      whatsappPhoneNumberId: 'pn-1',
    });
    expect(c.id).toBe('c1');
    // Matched on the number, so the name was never consulted.
    expect(clinicFindFirst).not.toHaveBeenCalled();
  });

  it(`refuses a ${MAX_DOCTORS_PER_CLINIC}th doctor rather than creating an unbookable one`, async () => {
    clinicFindFirst.mockResolvedValueOnce(LAKEVIEW);
    doctorCount.mockResolvedValueOnce(MAX_DOCTORS_PER_CLINIC);

    await expect(clinicForNewDoctor({ clinicName: 'Lakeview Clinic' })).rejects.toBeInstanceOf(
      ClinicFullError,
    );
  });

  it('allows the last doctor up to the limit', async () => {
    clinicFindFirst.mockResolvedValueOnce(LAKEVIEW);
    doctorCount.mockResolvedValueOnce(MAX_DOCTORS_PER_CLINIC - 1);

    await expect(clinicForNewDoctor({ clinicName: 'Lakeview Clinic' })).resolves.toMatchObject({
      id: 'c1',
    });
  });

  it('names the clinic and the limit in the refusal, so the console can show it', async () => {
    clinicFindFirst.mockResolvedValueOnce(LAKEVIEW);
    doctorCount.mockResolvedValueOnce(MAX_DOCTORS_PER_CLINIC);

    await expect(clinicForNewDoctor({ clinicName: 'Lakeview Clinic' })).rejects.toThrow(
      /Lakeview Clinic already has 5 doctors/,
    );
  });

  /** A clinic seeded before it had a number should adopt one when it arrives. */
  it('adopts a number for a clinic that had none', async () => {
    clinicFindUnique.mockResolvedValueOnce(null);
    clinicFindFirst.mockResolvedValueOnce({ ...LAKEVIEW, whatsappPhoneNumberId: null });

    await clinicForNewDoctor({ clinicName: 'Lakeview Clinic', whatsappPhoneNumberId: 'pn-9' });

    expect(clinicUpdate.mock.calls[0]?.[0]?.data?.whatsappPhoneNumberId).toBe('pn-9');
  });

  it('does not overwrite a number the clinic already has', async () => {
    clinicFindUnique.mockResolvedValueOnce(null);
    clinicFindFirst.mockResolvedValueOnce(LAKEVIEW);

    await clinicForNewDoctor({ clinicName: 'Lakeview Clinic', whatsappPhoneNumberId: 'pn-other' });

    expect(clinicUpdate).not.toHaveBeenCalled();
  });
});

/**
 * The missed-call routing key.
 *
 * Every clinic row in production had a null missed_call_number, so an authentic
 * Exotel call reached the webhook, authenticated, and then fell through to
 * "No clinic for this number" — the feature could not route at all. The number
 * was being written to the Doctor row instead, and the adopt branch below was
 * gated behind whatsappPhoneNumberId so it never filled the gap either.
 */
describe('the Exotel number reaches the clinic', () => {
  it('persists the missed-call number when the clinic is created', async () => {
    await clinicForNewDoctor({
      clinicName: 'New Practice',
      missedCallNumber: '918130819820',
    });

    expect(clinicCreate.mock.calls[0]?.[0]?.data?.missedCallNumber).toBe('918130819820');
  });

  it('adopts a missed-call number for a clinic that had none', async () => {
    clinicFindFirst.mockResolvedValueOnce({ ...LAKEVIEW, missedCallNumber: null });

    await clinicForNewDoctor({
      clinicName: 'Lakeview Clinic',
      missedCallNumber: '918130819820',
    });

    expect(clinicUpdate.mock.calls[0]?.[0]?.data?.missedCallNumber).toBe('918130819820');
  });

  /**
   * The regression that mattered: the clinic already has a WhatsApp number, so
   * the old single-key guard was satisfied and the ExoPhone was silently dropped.
   */
  it('adopts the ExoPhone even when the WhatsApp number is already set', async () => {
    clinicFindFirst.mockResolvedValueOnce({ ...LAKEVIEW, missedCallNumber: null });

    await clinicForNewDoctor({
      clinicName: 'Lakeview Clinic',
      whatsappPhoneNumberId: 'pn-1',
      missedCallNumber: '918130819820',
    });

    expect(clinicUpdate).toHaveBeenCalled();
    const data = clinicUpdate.mock.calls[0]?.[0]?.data;
    expect(data?.missedCallNumber).toBe('918130819820');
    // …and the number it already had is left alone.
    expect(data?.whatsappPhoneNumberId).toBeUndefined();
  });

  it('does not overwrite an ExoPhone the clinic already has', async () => {
    clinicFindFirst.mockResolvedValueOnce({ ...LAKEVIEW, missedCallNumber: '911111111111' });

    await clinicForNewDoctor({
      clinicName: 'Lakeview Clinic',
      missedCallNumber: '918130819820',
    });

    expect(clinicUpdate).not.toHaveBeenCalled();
  });
});
