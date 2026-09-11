import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import {
  apiKeyFingerprint,
  csrfMatches,
  newCsrfToken,
  readCookie,
  sessionExpiry,
  signSession,
  verifySessionToken,
  type SessionPayload,
} from './session';

function payload(overrides: Partial<SessionPayload> = {}): SessionPayload {
  return {
    d: 'doctor-1',
    k: apiKeyFingerprint('dk_secret'),
    exp: Math.floor(Date.now() / 1000) + 3600,
    csrf: newCsrfToken(),
    ...overrides,
  };
}

/** Minimal Request stand-in — readCookie only touches headers.cookie. */
function reqWithCookie(cookie?: string): Request {
  return { headers: cookie === undefined ? {} : { cookie } } as Request;
}

describe('signSession / verifySessionToken', () => {
  it('round-trips a payload', () => {
    const p = payload();
    const decoded = verifySessionToken(signSession(p));
    expect(decoded).toEqual(p);
  });

  it('rejects a tampered payload', () => {
    const [version, body, sig] = signSession(payload()).split('.');
    const evil = Buffer.from(JSON.stringify(payload({ d: 'doctor-2' }))).toString('base64url');
    expect(body).not.toEqual(evil);
    expect(verifySessionToken(`${version}.${evil}.${sig}`)).toBeNull();
  });

  it('rejects a tampered MAC of the correct length', () => {
    const [version, body, sig] = signSession(payload()).split('.');
    const bytes = Buffer.from(sig!, 'base64url');
    bytes[0] = bytes[0]! ^ 0xff; // flip a bit, keep the length
    expect(verifySessionToken(`${version}.${body}.${bytes.toString('base64url')}`)).toBeNull();
  });

  it('rejects a wrong-length MAC without throwing', () => {
    // timingSafeEqual throws on unequal lengths — the length guard must run first.
    const [version, body] = signSession(payload()).split('.');
    expect(() => verifySessionToken(`${version}.${body}.aaaa`)).not.toThrow();
    expect(verifySessionToken(`${version}.${body}.aaaa`)).toBeNull();
  });

  it('rejects an expired token', () => {
    const expired = payload({ exp: Math.floor(Date.now() / 1000) - 1 });
    expect(verifySessionToken(signSession(expired))).toBeNull();
  });

  it('rejects an unknown version prefix', () => {
    const [, body, sig] = signSession(payload()).split('.');
    expect(verifySessionToken(`v2.${body}.${sig}`)).toBeNull();
  });

  it('rejects malformed input', () => {
    for (const bad of ['', 'nope', 'v1.only-two', 'v1.a.b.c', null, undefined]) {
      expect(verifySessionToken(bad as string)).toBeNull();
    }
  });

  it('rejects a correctly-signed payload that is missing claims', () => {
    // Signed with the real key, so the MAC passes and ONLY the shape check can
    // reject it — which is the point of this case.
    for (const bad of [
      { d: 'doctor-1' },
      { d: 'doctor-1', k: 'abc', csrf: 'x' }, // no exp
      { k: 'abc', exp: Math.floor(Date.now() / 1000) + 60, csrf: 'x' }, // no d
      { d: 'doctor-1', k: 'abc', exp: 'soon', csrf: 'x' }, // exp wrong type
    ]) {
      const token = signSession(bad as unknown as SessionPayload);
      expect(verifySessionToken(token)).toBeNull();
    }
  });
});

describe('apiKeyFingerprint', () => {
  it('is stable and 16 hex chars', () => {
    const fp = apiKeyFingerprint('dk_abc');
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
    expect(apiKeyFingerprint('dk_abc')).toBe(fp);
  });

  it('changes when the key is rotated — this is the revocation mechanism', () => {
    expect(apiKeyFingerprint('dk_old')).not.toBe(apiKeyFingerprint('dk_new'));
  });
});

describe('readCookie', () => {
  it('returns null with no cookie header', () => {
    expect(readCookie(reqWithCookie(), 'clinic_session')).toBeNull();
  });

  it('reads a lone cookie', () => {
    expect(readCookie(reqWithCookie('clinic_session=abc'), 'clinic_session')).toBe('abc');
  });

  it('picks the right cookie out of several', () => {
    const req = reqWithCookie('foo=1; clinic_session=abc; bar=2');
    expect(readCookie(req, 'clinic_session')).toBe('abc');
  });

  it('keeps "=" inside the value — session tokens are base64url with padding', () => {
    const req = reqWithCookie('clinic_session=v1.aaa=.bbb==');
    expect(readCookie(req, 'clinic_session')).toBe('v1.aaa=.bbb==');
  });

  it('does not match a cookie whose name merely ends with the target', () => {
    expect(readCookie(reqWithCookie('xclinic_session=abc'), 'clinic_session')).toBeNull();
  });

  it('returns null for an absent name', () => {
    expect(readCookie(reqWithCookie('foo=1'), 'clinic_session')).toBeNull();
  });

  it('url-decodes the value', () => {
    expect(readCookie(reqWithCookie('n=a%20b'), 'n')).toBe('a b');
  });
});

describe('csrfMatches', () => {
  it('accepts an exact match', () => {
    const t = newCsrfToken();
    expect(csrfMatches(t, t)).toBe(true);
  });

  it('rejects a mismatch, a missing value, and a length mismatch', () => {
    const t = newCsrfToken();
    expect(csrfMatches(t, newCsrfToken())).toBe(false);
    expect(csrfMatches(t, undefined)).toBe(false);
    expect(csrfMatches(t, '')).toBe(false);
    expect(() => csrfMatches(t, 'short')).not.toThrow();
    expect(csrfMatches(t, 'short')).toBe(false);
  });
});

describe('sessionExpiry', () => {
  it('is the configured number of days ahead', () => {
    const now = new Date('2026-09-11T00:00:00Z');
    // vitest env sets no TTL, so the default of 7 days applies.
    expect(sessionExpiry(now)).toBe(Math.floor(now.getTime() / 1000) + 7 * 86_400);
  });
});
