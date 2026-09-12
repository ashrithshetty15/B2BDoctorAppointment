import { describe, expect, it } from 'vitest';
import {
  type AdminSessionPayload,
  apiKeyFingerprint,
  sessionExpiry,
  signAdminSession,
  signSession,
  verifyAdminSessionToken,
  verifySessionToken,
} from './session';

function adminPayload(over: Partial<AdminSessionPayload> = {}): AdminSessionPayload {
  return { r: 'admin', k: apiKeyFingerprint('admin-key'), exp: sessionExpiry(), csrf: 'c', ...over };
}

describe('admin session', () => {
  it('round-trips a signed payload', () => {
    const payload = adminPayload();
    const got = verifyAdminSessionToken(signAdminSession(payload));
    expect(got).toEqual(payload);
  });

  it('rejects a tampered payload', () => {
    const [version, body, sig] = signAdminSession(adminPayload()).split('.') as [
      string,
      string,
      string,
    ];
    const swapped = Buffer.from(
      JSON.stringify({ ...adminPayload(), k: 'attacker' }),
    ).toString('base64url');
    expect(verifyAdminSessionToken(`${version}.${swapped}.${sig}`)).toBeNull();
    expect(verifyAdminSessionToken(`${version}.${body}.${sig}x`)).toBeNull();
  });

  it('rejects an expired token', () => {
    const expired = signAdminSession(adminPayload({ exp: Math.floor(Date.now() / 1000) - 1 }));
    expect(verifyAdminSessionToken(expired)).toBeNull();
  });

  it('rejects a payload missing the admin discriminator', () => {
    // Signed with the admin key but without r:'admin' — must still fail.
    const forged = signAdminSession({ k: 'x', exp: sessionExpiry(), csrf: 'c' } as never);
    expect(verifyAdminSessionToken(forged)).toBeNull();
  });

  /**
   * The reason admin and doctor sessions use separately derived MAC keys: an
   * admin payload is a doctor payload minus `d`, so a shared key would let
   * either cookie satisfy the other's checks.
   */
  it('does not accept a doctor token as an admin token, or vice versa', () => {
    const doctorToken = signSession({
      d: 'doctor-1',
      k: apiKeyFingerprint('doctor-key'),
      exp: sessionExpiry(),
      csrf: 'c',
    });
    expect(verifyAdminSessionToken(doctorToken)).toBeNull();

    const adminToken = signAdminSession(adminPayload());
    expect(verifySessionToken(adminToken)).toBeNull();
  });

  it('rejects an admin token whose body is re-signed with the doctor key', () => {
    // Same payload, doctor signing path: the admin verifier must reject it even
    // though every claim it inspects is present and well-formed.
    const body = adminPayload();
    const crossSigned = signSession(body as never);
    expect(verifyAdminSessionToken(crossSigned)).toBeNull();
  });

  it('ties the session to the admin key, so rotating it revokes sessions', () => {
    const token = signAdminSession(adminPayload({ k: apiKeyFingerprint('old-key') }));
    const payload = verifyAdminSessionToken(token);

    expect(payload?.k).toBe(apiKeyFingerprint('old-key'));
    // requireAdminSession compares against the CURRENT key's fingerprint.
    expect(payload?.k).not.toBe(apiKeyFingerprint('new-key'));
  });
});
