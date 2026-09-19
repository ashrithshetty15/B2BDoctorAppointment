import { beforeEach, describe, expect, it, vi } from 'vitest';

const clinicFindUnique = vi.fn();
const doctorFindMany = vi.fn();
const doctorFindUnique = vi.fn();

vi.mock('../../db/prisma', () => ({
  prisma: {
    clinic: { findUnique: (...a: unknown[]) => clinicFindUnique(...a) },
    doctor: {
      findMany: (...a: unknown[]) => doctorFindMany(...a),
      findUnique: (...a: unknown[]) => doctorFindUnique(...a),
    },
  },
}));

const { env } = vi.hoisted(() => ({
  env: {
    DASHBOARD_SESSION_SECRET: 'x'.repeat(40),
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DASHBOARD_SESSION_TTL_DAYS: 7,
  } as Record<string, unknown>,
}));
vi.mock('../../config/env', () => ({ env }));

import { apiKeyFingerprint, newCsrfToken, sessionExpiry, signSession } from './session';
import { requireDoctorAuth } from './auth';

const CLINIC = { id: 'c1', name: 'Lakeview', apiKey: 'ck_secret', status: 'ACTIVE' };
const DOCTORS = [
  { id: 'd1', name: 'Arjun Rao', specialty: 'Paediatrician', clinicId: 'c1', status: 'ACTIVE', clinic: CLINIC },
  { id: 'd2', name: 'Kavya Shetty', specialty: 'Dermatologist', clinicId: 'c1', status: 'ACTIVE', clinic: CLINIC },
];

const cookieFor = (payload: Record<string, unknown>) =>
  `clinic_session=${signSession({
    k: apiKeyFingerprint(CLINIC.apiKey),
    exp: sessionExpiry(),
    csrf: newCsrfToken(),
    ...payload,
  } as never)}`;

const run = async (cookie: string) => {
  const headers: Record<string, string> = { cookie };
  const req = {
    headers,
    path: '/app/queue',
    method: 'GET',
    // requireDoctorAuth reads the api-key header before falling back to cookies.
    header: (name: string) => headers[name.toLowerCase()],
    get: (name: string) => headers[name.toLowerCase()],
    // Enough Express surface for the unauthorised path to answer as JSON
    // rather than trying to render a sign-in page.
    accepts: () => 'json',
    xhr: true,
  } as never;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), redirect: vi.fn(), type: vi.fn().mockReturnThis(), send: vi.fn() } as never;
  const next = vi.fn();
  await requireDoctorAuth(req, res, next);
  return { req: req as unknown as Record<string, unknown>, next };
};

beforeEach(() => {
  clinicFindUnique.mockReset().mockResolvedValue(CLINIC);
  doctorFindMany.mockReset().mockResolvedValue(DOCTORS);
  doctorFindUnique.mockReset().mockResolvedValue(null);
});

/**
 * One sign-in for a front desk covering several doctors. The doctor in the
 * cookie is only ever *viewed*, so it is re-checked against the clinic on every
 * request — an edited id must not open another clinic's queue.
 */
describe('clinic session', () => {
  it('signs in and views the doctor the cookie names', async () => {
    const { req, next } = await run(cookieFor({ c: 'c1', d: 'd2' }));

    expect(next).toHaveBeenCalled();
    expect((req['doctor'] as { id: string }).id).toBe('d2');
  });

  it('offers every doctor in the clinic to switch to', async () => {
    const { req } = await run(cookieFor({ c: 'c1', d: 'd1' }));

    expect(req['clinicDoctors']).toHaveLength(2);
    expect((req['doctor'] as { clinicDoctors: unknown[] }).clinicDoctors).toHaveLength(2);
  });

  /** The lookup is scoped to the clinic, so a foreign id simply is not found. */
  it('falls back rather than opening a doctor outside the clinic', async () => {
    const { req } = await run(cookieFor({ c: 'c1', d: 'd-from-another-clinic' }));

    expect((req['doctor'] as { id: string }).id).toBe('d1');
    expect(doctorFindMany.mock.calls[0]?.[0]?.where).toMatchObject({
      clinicId: 'c1',
      status: 'ACTIVE',
    });
  });

  /** Rotating the clinic key is the only revocation there is; it must work. */
  it('refuses a cookie minted from a rotated key', async () => {
    clinicFindUnique.mockResolvedValue({ ...CLINIC, apiKey: 'ck_rotated' });
    const { req, next } = await run(cookieFor({ c: 'c1', d: 'd1' }));

    expect(next).not.toHaveBeenCalled();
    expect(req['doctor']).toBeUndefined();
  });

  it('refuses a disabled clinic', async () => {
    clinicFindUnique.mockResolvedValue({ ...CLINIC, status: 'DISABLED' });
    const { next } = await run(cookieFor({ c: 'c1', d: 'd1' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('refuses a clinic with no active doctors', async () => {
    doctorFindMany.mockResolvedValue([]);
    const { next } = await run(cookieFor({ c: 'c1', d: 'd1' }));
    expect(next).not.toHaveBeenCalled();
  });

  /** A doctor signed in with their own key has nobody to switch to. */
  it('gives a plain doctor session no switcher', async () => {
    doctorFindUnique.mockResolvedValue({
      id: 'solo',
      name: 'Ramesh',
      apiKey: 'dk_solo',
      status: 'ACTIVE',
      clinic: null,
    });

    const cookie = `clinic_session=${signSession({
      d: 'solo',
      k: apiKeyFingerprint('dk_solo'),
      exp: sessionExpiry(),
      csrf: newCsrfToken(),
    } as never)}`;
    const { req } = await run(cookie);

    expect((req['doctor'] as { id: string }).id).toBe('solo');
    expect(req['clinicDoctors']).toBeUndefined();
  });
});
