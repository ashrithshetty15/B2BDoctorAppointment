import type { Doctor } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../../config/env';
import { prisma } from '../../db/prisma';
import { getDoctorByApiKey } from '../../domain/doctors';
import { wantsHtml } from '../web/negotiate';
import {
  CSRF_HEADER,
  SESSION_COOKIE,
  apiKeyFingerprint,
  csrfMatches,
  readCookie,
  verifySessionToken,
} from './session';

/**
 * Two ways to authenticate as a doctor:
 *
 *  - `x-api-key` / `Authorization: Bearer` — programmatic callers (curl, the
 *    clinic's own scripts). Inherently CSRF-safe, because a cross-site page
 *    cannot set a custom header on a simple request.
 *  - a session cookie — the browser dashboard, which must never see the raw
 *    API key. Cookies ARE sent cross-site on form posts, so cookie-authenticated
 *    mutations additionally require a CSRF token (see requireCsrf).
 *
 * The key both authenticates and scopes: a doctor's credential only ever opens
 * that doctor's rows.
 */

export type AuthMode = 'api-key' | 'cookie';

declare module 'express-serve-static-core' {
  interface Request {
    doctor?: Doctor;
    authMode?: AuthMode;
    /** Present only for cookie auth — the value pages must echo back. */
    csrfToken?: string;
  }
}

function readKey(req: Request): string {
  const header = req.header('x-api-key');
  if (header) return header.trim();

  const auth = req.header('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();

  return '';
}

/** Browser navigations get bounced to login; API callers get JSON. */
function unauthorized(req: Request, res: Response, message: string): void {
  if (wantsHtml(req)) {
    res.redirect(302, `/app/login?next=${encodeURIComponent(req.originalUrl)}`);
    return;
  }
  res.status(401).json({ error: message });
}

async function doctorFromCookie(req: Request): Promise<Doctor | null> {
  const payload = verifySessionToken(readCookie(req, SESSION_COOKIE));
  if (!payload) return null;

  const doctor = await prisma.doctor.findUnique({ where: { id: payload.d } });
  if (!doctor) return null;

  // Revocation: the cookie pins a fingerprint of the API key it was minted
  // from, so rotating Doctor.apiKey invalidates every outstanding session.
  if (apiKeyFingerprint(doctor.apiKey) !== payload.k) return null;

  req.csrfToken = payload.csrf;
  return doctor;
}

/**
 * Authenticate only. Use for routes whose resource is not addressed by a
 * doctor id — e.g. /appointment/:id/status, where ownership is checked against
 * the loaded appointment in the handler instead.
 */
export async function requireDoctorAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const key = readKey(req);

  if (key) {
    const doctor = await getDoctorByApiKey(key);
    if (!doctor) {
      unauthorized(req, res, 'Invalid API key');
      return;
    }
    req.doctor = doctor;
    req.authMode = 'api-key';
    next();
    return;
  }

  const doctor = await doctorFromCookie(req);
  if (!doctor) {
    unauthorized(req, res, 'Missing x-api-key header');
    return;
  }

  req.doctor = doctor;
  req.authMode = 'cookie';
  next();
}

/**
 * Authenticate AND require that the route's `:doctorId` is the credential's own
 * doctor.
 *
 * Fails closed: a missing `:doctorId` is a 403, not a pass. The previous
 * version read `req.params['id']` and treated a missing param as "no check
 * needed", which silently became a no-op on any route that did not happen to
 * declare it — including, at one point, a route where `:id` was an appointment
 * id. Mount this on every /doctor/:doctorId/... path.
 */
export async function requireDoctorScope(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await requireDoctorAuth(req, res, () => {
    const routeDoctorId = req.params['doctorId'];

    if (!routeDoctorId) {
      // A programming error, not a client error: the route forgot the param.
      res.status(403).json({ error: 'Route is missing a :doctorId parameter' });
      return;
    }
    if (routeDoctorId !== req.doctor?.id) {
      res.status(403).json({ error: 'API key does not belong to this doctor' });
      return;
    }

    next();
  });
}

/**
 * CSRF protection for cookie-authenticated mutations.
 *
 * Skipped entirely for `x-api-key` callers, so existing programmatic clients
 * are unaffected. For cookie auth, the token minted into the session must be
 * echoed in the X-CSRF-Token header — which a cross-site form post cannot do.
 *
 * Layered under SameSite=Lax on the cookie itself; this is the application
 * level of that defence, and it matters because POST /doctor/:id/leave cancels
 * every appointment for a day.
 */
export function requireCsrf(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }

  if (req.authMode !== 'cookie') {
    next();
    return;
  }

  // When the browser tells us the request is cross-site, refuse regardless.
  const site = req.header('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') {
    res.status(403).json({ error: 'Cross-site request rejected' });
    return;
  }

  const origin = req.header('origin');
  if (origin) {
    const expected = `${req.protocol}://${req.get('host') ?? ''}`;
    if (origin !== expected) {
      res.status(403).json({ error: 'Cross-origin request rejected' });
      return;
    }
  }

  if (!req.csrfToken || !csrfMatches(req.csrfToken, req.header(CSRF_HEADER))) {
    res.status(403).json({ error: 'CSRF token missing or invalid' });
    return;
  }

  next();
}

/** @deprecated Use requireDoctorScope (doctor-scoped) or requireDoctorAuth. */
export const requireDoctorApiKey = requireDoctorAuth;

export function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  const key = readKey(req);
  if (!key || key !== env.ADMIN_API_KEY) {
    res.status(401).json({ error: 'Invalid admin key' });
    return;
  }
  next();
}
