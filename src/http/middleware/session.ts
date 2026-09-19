import crypto from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';
import { env } from '../../config/env';

/**
 * Dashboard session cookies.
 *
 * A doctor's API key must never reach browser JavaScript, so the login page
 * trades it for an HttpOnly cookie holding a stateless HMAC-signed token:
 *
 *   v1.<base64url(payload)>.<base64url(HMAC-SHA256 over the payload string)>
 *
 * Stateless on purpose — a session table would cost a model, a migration, an
 * expiry sweep and a second query per request, and the only revocation event
 * that matters for a single-doctor clinic comes free: the payload carries a
 * fingerprint of the API key, so rotating Doctor.apiKey invalidates every
 * outstanding cookie.
 */

export const SESSION_COOKIE = 'clinic_session';
export const CSRF_HEADER = 'x-csrf-token';

const VERSION = 'v1';

export interface SessionPayload {
  /**
   * The clinic, when this session was opened with a clinic key.
   *
   * Its presence is what separates the two kinds of sign-in: with it, `d` is
   * merely whichever doctor is being looked at and may be switched freely
   * within this clinic; without it, `d` is who signed in and cannot change.
   */
  c?: string;
  /** Doctor id — who signed in, or who is being viewed. */
  d: string;
  /**
   * Fingerprint of the key this session was minted from — the doctor's for a
   * doctor session, the clinic's for a clinic one. Rotating that key ends every
   * outstanding session, which is the only revocation there is.
   */
  k: string;
  /** Expiry, epoch seconds. */
  exp: number;
  /** Per-session CSRF token, echoed into each page as a <meta> tag. */
  csrf: string;
}

/**
 * In development a missing secret falls back to a per-process random key, so
 * cookies simply stop working across a restart instead of being forgeable.
 * Production is guaranteed a real secret by the guard in config/env.ts.
 */
const SESSION_KEY: string =
  env.DASHBOARD_SESSION_SECRET ?? crypto.randomBytes(32).toString('hex');

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function mac(payloadB64: string): Buffer {
  return crypto.createHmac('sha256', SESSION_KEY).update(payloadB64).digest();
}

/** Short fingerprint of an API key; changing the key invalidates old cookies. */
export function apiKeyFingerprint(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
}

export function newCsrfToken(): string {
  return crypto.randomBytes(16).toString('base64url');
}

export function sessionExpiry(now: Date = new Date()): number {
  return Math.floor(now.getTime() / 1000) + env.DASHBOARD_SESSION_TTL_DAYS * 86_400;
}

export function signSession(payload: SessionPayload): string {
  const body = b64url(JSON.stringify(payload));
  return `${VERSION}.${body}.${b64url(mac(body))}`;
}

/**
 * Verify and decode a token. Returns null for anything untrustworthy — wrong
 * version, tampered payload, bad MAC, expired, or unparseable.
 *
 * The MAC is checked over the exact base64url string BEFORE the JSON is
 * parsed, so a hostile payload never reaches JSON.parse.
 */
export function verifySessionToken(token: string | null | undefined): SessionPayload | null {
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [version, body, sig] = parts as [string, string, string];
  if (version !== VERSION || !body || !sig) return null;

  const expected = mac(body);
  const provided = Buffer.from(sig, 'base64url');
  // timingSafeEqual throws on a length mismatch, so compare lengths first.
  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(provided, expected)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Partial<SessionPayload>;
  if (
    typeof p.d !== 'string' ||
    typeof p.k !== 'string' ||
    typeof p.csrf !== 'string' ||
    typeof p.exp !== 'number' ||
    (p.c !== undefined && typeof p.c !== 'string')
  ) {
    return null;
  }

  if (p.exp * 1000 <= Date.now()) return null;

  // Rebuilt field by field rather than returned whole, so nothing a forged body
  // carries beyond the known shape survives. Every field therefore has to be
  // named here — `c` was added to the type and missed here, which silently
  // turned every clinic session back into a doctor one.
  return { d: p.d, k: p.k, exp: p.exp, csrf: p.csrf, ...(p.c ? { c: p.c } : {}) };
}

/** Read one cookie without pulling in cookie-parser. */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(';')) {
        const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    // Only the first '=' separates name from value; the value may contain more.
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    // Keyed off NODE_ENV rather than req.secure so behaviour is deterministic
    // and independent of proxy headers.
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: env.DASHBOARD_SESSION_TTL_DAYS * 86_400_000,
  };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
}

/** True when both CSRF tokens are present and equal, compared in constant time. */
export function csrfMatches(expected: string, provided: string | undefined): boolean {
  if (!provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Operator (admin) sessions — a separate credential from a doctor's, so they
 * get a separate cookie and a separate signing key.
 *
 * The key derivation is the security-critical part. An admin payload is a
 * doctor payload minus `d`, so sharing one MAC key would let a doctor's cookie
 * verify as an admin's: every claim the admin check looks at would be present
 * and correctly signed. Deriving a distinct key means a token minted for one
 * audience simply fails the other's MAC, independently of payload shape.
 *
 * Revocation works as it does for doctors: the payload pins a fingerprint of
 * ADMIN_API_KEY, so changing that env var logs every operator out.
 */

export const ADMIN_SESSION_COOKIE = 'clinic_admin';

const ADMIN_VERSION = 'a1';

const ADMIN_SESSION_KEY: Buffer = crypto
  .createHmac('sha256', SESSION_KEY)
  .update('admin-session')
  .digest();

export interface AdminSessionPayload {
  /** Discriminator; also checked on verify as defence in depth. */
  r: 'admin';
  /** apiKeyFingerprint(env.ADMIN_API_KEY) at the time of login. */
  k: string;
  exp: number;
  csrf: string;
}

function adminMac(payloadB64: string): Buffer {
  return crypto.createHmac('sha256', ADMIN_SESSION_KEY).update(payloadB64).digest();
}

export function signAdminSession(payload: AdminSessionPayload): string {
  const body = b64url(JSON.stringify(payload));
  return `${ADMIN_VERSION}.${body}.${b64url(adminMac(body))}`;
}

export function verifyAdminSessionToken(
  token: string | null | undefined,
): AdminSessionPayload | null {
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [version, body, sig] = parts as [string, string, string];
  if (version !== ADMIN_VERSION || !body || !sig) return null;

  const expected = adminMac(body);
  const provided = Buffer.from(sig, 'base64url');
  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(provided, expected)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Partial<AdminSessionPayload>;
  if (p.r !== 'admin' || typeof p.k !== 'string' || typeof p.csrf !== 'string') return null;
  if (typeof p.exp !== 'number' || p.exp * 1000 <= Date.now()) return null;

  return { r: 'admin', k: p.k, exp: p.exp, csrf: p.csrf };
}

export function setAdminSessionCookie(res: Response, token: string): void {
  res.cookie(ADMIN_SESSION_COOKIE, token, sessionCookieOptions());
}

export function clearAdminSessionCookie(res: Response): void {
  res.clearCookie(ADMIN_SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
}
