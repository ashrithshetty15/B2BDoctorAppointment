import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findUnique = vi.fn();
const count = vi.fn();
const findFirst = vi.fn();

vi.mock('../db/prisma', () => ({
  prisma: {
    doctor: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      count: (...a: unknown[]) => count(...a),
      findFirst: (...a: unknown[]) => findFirst(...a),
    },
  },
}));

// vi.hoisted, not a plain const: the mock factory below returns `env` eagerly and
// vi.mock is hoisted above ordinary declarations. The prisma mocks escape this
// because they only touch their consts inside lazy arrow bodies.
const { env } = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock('../config/env', () => ({ env }));
vi.mock('../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

// vi.mock is hoisted above this import, so the mocks are in place.
import { resolveDoctorForChannel } from './doctors';

const SUNRISE = { id: 'doc-sunrise', clinicName: 'Sunrise' };
const FALLBACK = { id: 'doc-fallback', clinicName: 'Fallback' };

beforeEach(() => {
  findUnique.mockReset();
  count.mockReset();
  findFirst.mockReset();
  env['MESSAGING_PROVIDER'] = 'whatsapp_cloud';
  env['DEFAULT_DOCTOR_ID'] = 'doc-fallback';
});

afterEach(() => {
  for (const k of Object.keys(env)) delete env[k];
});

describe('resolveDoctorForChannel', () => {
  it('routes a known phone_number_id to its doctor', async () => {
    findUnique.mockResolvedValueOnce(SUNRISE);
    await expect(resolveDoctorForChannel('1240078345864841')).resolves.toBe(SUNRISE);
    expect(findUnique).toHaveBeenCalledWith({
      where: { whatsappPhoneNumberId: '1240078345864841' },
    });
  });

  /**
   * The cross-tenant leak this guard exists for: an unrecognised number used to
   * fall through to DEFAULT_DOCTOR_ID, handing one clinic's patients — names,
   * phone numbers, booking history — to a different clinic's queue. Silently,
   * and more likely the more clinics there are.
   */
  it('refuses an unknown number on a real provider instead of using the fallback', async () => {
    findUnique.mockResolvedValueOnce(null);
    await expect(resolveDoctorForChannel('999-not-provisioned')).resolves.toBeNull();
    // The fallback lookup must never even be attempted.
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(count).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('refuses even when no DEFAULT_DOCTOR_ID is configured', async () => {
    delete env['DEFAULT_DOCTOR_ID'];
    findUnique.mockResolvedValueOnce(null);
    await expect(resolveDoctorForChannel('999-not-provisioned')).resolves.toBeNull();
    expect(count).not.toHaveBeenCalled();
  });

  /**
   * The console adapter has no phone_number_id, which is the only reason these
   * fallbacks exist. Local development must keep working.
   */
  it('still falls back for the console adapter', async () => {
    env['MESSAGING_PROVIDER'] = 'console';
    findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(FALLBACK);
    await expect(resolveDoctorForChannel('console')).resolves.toBe(FALLBACK);
    expect(findUnique).toHaveBeenLastCalledWith({ where: { id: 'doc-fallback' } });
  });

  it('falls back to the only row when nothing is configured, on console', async () => {
    env['MESSAGING_PROVIDER'] = 'console';
    delete env['DEFAULT_DOCTOR_ID'];
    findUnique.mockResolvedValueOnce(null);
    count.mockResolvedValueOnce(1);
    findFirst.mockResolvedValueOnce(SUNRISE);
    await expect(resolveDoctorForChannel('console')).resolves.toBe(SUNRISE);
  });

  it('refuses rather than guessing when several doctors exist, on console', async () => {
    env['MESSAGING_PROVIDER'] = 'console';
    delete env['DEFAULT_DOCTOR_ID'];
    findUnique.mockResolvedValueOnce(null);
    count.mockResolvedValueOnce(2);
    await expect(resolveDoctorForChannel('console')).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('skips the channel lookup entirely when the address is empty', async () => {
    findUnique.mockResolvedValueOnce(FALLBACK);
    await expect(resolveDoctorForChannel('')).resolves.toBe(FALLBACK);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'doc-fallback' } });
  });
});
